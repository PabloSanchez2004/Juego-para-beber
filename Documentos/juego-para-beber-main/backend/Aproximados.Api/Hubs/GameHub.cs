using Aproximados.Api.Models;
using Aproximados.Api.Services;
using Microsoft.AspNetCore.SignalR;

namespace Aproximados.Api.Hubs;

/// <summary>
/// Hub SignalR principal del juego Aproximados.
///
/// Protocolo cliente→servidor (métodos invocables):
///   RoomExists(code)                      → bool (para validar el código antes de pedir el nombre)
///   CreateRoom(name, alcoholFree, maxRounds) → RoomCreated | Error
///   JoinRoom(code, name, alcoholFree)     → JoinedRoom | Error
///   RejoinRoom(roomId, playerId)          → ReconnectedRoom | Error
///   Reconnect(code, playerId)             → alias de RejoinRoom
///   StartGame(maxRounds)                  → GameStateUpdated (broadcast). Solo el anfitrión.
///   KickPlayer(targetPlayerId)            → Kicked (al expulsado) + GameStateUpdated. Solo el anfitrión.
///   SubmitQuestion(question)              → GameStateUpdated (broadcast) + lanza pre-cálculo IA en 2º plano
///   SubmitGuess(guess)                    → GuessAcknowledged | GameStateUpdated (la última recoge el pre-cálculo)
///   RequestResults()                      → GameStateUpdated (broadcast, fuerza cierre ronda)
///   NextRound()                           → GameStateUpdated (broadcast)
///   LeaveRoom()                           → (limpieza)
///
/// Protocolo servidor→cliente (eventos):
///   RoomCreated(roomCode, playerId, state)
///   JoinedRoom(playerId, state)
///   ReconnectedRoom(state)
///   GameStateUpdated(state)               → broadcast a la sala
///   GuessAcknowledged()                   → solo al jugador que envió
///   Error(message)                        → solo al cliente que causó el error
///   PlayerDisconnected(playerName)        → broadcast
///   PlayerReconnected(playerName)         → broadcast
///   PlayerKicked(playerName)              → broadcast al resto de la sala
///   Kicked(reason)                        → solo al jugador expulsado
///   RoomClosed(reason)                    → broadcast
/// </summary>
public sealed class GameHub : Hub
{
    private readonly RoomManager _roomManager;
    private readonly GeminiService _gemini;
    private readonly ILogger<GameHub> _logger;

    // Clave de contexto para recuperar sala/jugador en OnDisconnectedAsync
    private const string RoomCodeKey = "roomCode";
    private const string PlayerIdKey = "playerId";

    public GameHub(RoomManager roomManager, GeminiService gemini, ILogger<GameHub> logger)
    {
        _roomManager = roomManager;
        _gemini = gemini;
        _logger = logger;
    }

    // ── Conexión / desconexión ─────────────────────────────────────────────

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var roomCode = Context.Items[RoomCodeKey] as string;
        var playerId = Context.Items[PlayerIdKey] as string;

        if (roomCode is not null && playerId is not null)
        {
            var room = _roomManager.GetRoom(roomCode);
            if (room is not null)
            {
                // No expulsar: solo marcar. Si ya se reenganchó con otro ConnectionId, no-op.
                if (room.TryMarkDisconnected(playerId, Context.ConnectionId))
                {
                    var player = room.Players.FirstOrDefault(p => p.PlayerId == playerId);
                    if (player is not null)
                    {
                        await Clients.Group(roomCode).SendAsync(
                            "PlayerDisconnected", player.Name);
                        await BroadcastState(room, excludePlayerId: null);
                        if (room.ReadyToFinalize) await FinalizeRoundAsync(room);
                    }

                    _logger.LogInformation(
                        "Jugador {PlayerId} desconectado de sala {Code}. Asiento reservado {Minutes} min",
                        playerId, roomCode, Room.ReconnectGracePeriod.TotalMinutes);
                }
            }
        }

        await base.OnDisconnectedAsync(exception);
    }

    // ── Validar código antes de pedir el nombre ────────────────────────────

    /// <summary>
    /// Comprueba si una sala existe y sigue admitiendo gente. El cliente lo usa en
    /// el paso «introduce el código» para no pedir el nombre de una sala fantasma.
    /// </summary>
    public Task<bool> RoomExists(string code)
    {
        var normalized = (code ?? string.Empty).Trim().ToUpperInvariant();
        var room = _roomManager.GetRoom(normalized);
        return Task.FromResult(room is not null && room.Phase == GamePhase.Lobby && room.Players.Count < Room.MaxPlayers);
    }

    // ── Crear sala ─────────────────────────────────────────────────────────

    public async Task CreateRoom(string name, bool alcoholFree, int maxRounds = Room.DefaultMaxRounds, string? playerId = null)
    {
        try
        {
            if (!ValidateName(name, out var nameError))
            {
                await SendError(nameError);
                return;
            }

            var room = _roomManager.CreateRoom();
            if (room is null)
            {
                await SendError("No se pueden crear más salas ahora mismo. Inténtalo en un momento.");
                return;
            }

            room.TrySetMaxRounds(maxRounds);

            var player = NewPlayer(name, alcoholFree, playerId);

            if (!room.TryAddPlayer(player))
            {
                _roomManager.RemoveRoom(room.Code);
                await SendError("Error al crear la sala. Inténtalo de nuevo.");
                return;
            }

            await LeaveRoom();
            await Groups.AddToGroupAsync(Context.ConnectionId, room.Code);
            StoreContext(room.Code, player.PlayerId);

            var state = room.ToDto(player.PlayerId);
            await Clients.Caller.SendAsync("RoomCreated", room.Code, player.PlayerId, state, player.ReconnectToken);

            _logger.LogInformation("Sala {Code} creada por {Name}", room.Code, name);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "CreateRoom falló para {Name}", name);
            await SendError("No se pudo crear la sala. Inténtalo de nuevo.");
        }
    }

    // ── Unirse a sala ──────────────────────────────────────────────────────

    public async Task JoinRoom(string code, string name, bool alcoholFree, string? playerId = null)
    {
        if (!ValidateName(name, out var nameError))
        {
            await SendError(nameError);
            return;
        }

        code = (code ?? string.Empty).Trim().ToUpperInvariant();
        var room = _roomManager.GetRoom(code);

        if (room is null)
        {
            await SendError($"No existe ninguna sala con el código «{code}». Revísalo.");
            return;
        }

        // Recarga a mitad de partida: el PlayerId persistente recupera el asiento.
        if (!string.IsNullOrWhiteSpace(playerId) &&
            room.Players.Any(p => p.PlayerId == playerId))
        {
            await SendError("Ese jugador ya existe. Recupera tu sesión original o usa otro perfil.");
            return;
        }

        if (room.Phase != GamePhase.Lobby)
        {
            await SendError("La partida ya ha empezado. Podrás unirte a una nueva sala.");
            return;
        }

        var player = NewPlayer(name, alcoholFree, playerId);

        var rejection = room.AddPlayer(player);
        if (rejection != JoinRejection.None)
        {
            await SendError(DescribeRejection(rejection, player.Name));
            return;
        }

        await LeaveRoom();
        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        StoreContext(code, player.PlayerId);

        var state = room.ToDto(player.PlayerId);
        await Clients.Caller.SendAsync("JoinedRoom", player.PlayerId, state, player.ReconnectToken);

        // Notificar al resto de la sala
        await BroadcastState(room, excludePlayerId: null);

        _logger.LogInformation("Jugador {Name} se unió a sala {Code}", name, code);
    }

    // ── Reconexión ─────────────────────────────────────────────────────────

    /// <summary>
    /// Recupera el asiento por PlayerId persistente y sustituye el ConnectionId
    /// volátil. La última conexión gana: así un refresh o un corte 5G no se
    /// rechaza como «otro dispositivo».
    /// </summary>
    public async Task RejoinRoom(string roomId, string playerId, string? reconnectToken)
    {
        var code = (roomId ?? string.Empty).Trim().ToUpperInvariant();
        var room = _roomManager.GetRoom(code);

        if (room is null)
        {
            await SendError("La sala ya no existe. Crea una nueva.");
            return;
        }

        var player = room.Players.FirstOrDefault(p => p.PlayerId == playerId);
        if (player is null || !player.HasReconnectToken(reconnectToken))
        {
            await SendError("Tu sesión expiró. Únete de nuevo con tu nombre.");
            return;
        }

        if (Context.Items[RoomCodeKey] is string currentCode &&
            (currentCode != code || Context.Items[PlayerIdKey] as string != playerId))
            await LeaveRoom();
        var previousConnection = player.ConnectionId;
        if (!room.TryReconnectPlayer(playerId, Context.ConnectionId))
        {
            await SendError("No se pudo reconectar. La sala puede haber cerrado.");
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        StoreContext(code, playerId);
        if (previousConnection != Context.ConnectionId)
            await Groups.RemoveFromGroupAsync(previousConnection, code);

        // Estado privado de la ronda (pregunta, progreso, su propia estimación).
        var state = room.ToDto(playerId);
        await Clients.Caller.SendAsync("ReconnectedRoom", state);
        await Clients.Group(code).SendAsync("PlayerReconnected", player.Name);
        await BroadcastState(room, excludePlayerId: null);

        _logger.LogInformation(
            "Jugador {Name} reenganchado a sala {Code} con ConnectionId {Conn}",
            player.Name, code, Context.ConnectionId);
    }

    /// <summary>Alias retrocompatible de <see cref="RejoinRoom"/>.</summary>
    public Task Reconnect(string code, string playerId, string? reconnectToken) => RejoinRoom(code, playerId, reconnectToken);

    // ── Iniciar juego ──────────────────────────────────────────────────────

    public async Task StartGame(int maxRounds = Room.DefaultMaxRounds)
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;

        if (!room.IsAdmin(player.PlayerId))
        {
            await SendError("Solo el anfitrión puede empezar la partida.");
            return;
        }

        // Si el cliente no manda un valor útil, usamos el que el host eligió al crear la sala.
        if (maxRounds < 1)
            maxRounds = room.MaxRounds;
        maxRounds = Math.Clamp(maxRounds, 1, 20);

        if (!room.TryStartGame(maxRounds, room.IsAlcoholFreeRoom))
        {
            await SendError("No se puede iniciar: necesitas al menos 2 jugadores conectados.");
            return;
        }

        await BroadcastState(room, excludePlayerId: null);
        _logger.LogInformation("Juego iniciado en sala {Code}, {Rounds} rondas", room.Code, maxRounds);
    }

    /// <summary>Configura quién puede estimar; únicamente el anfitrión y antes de empezar.</summary>
    public async Task SetRedactorCanGuess(string roomCode, bool enabled)
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;
        if (!string.Equals(room.Code, roomCode?.Trim(), StringComparison.OrdinalIgnoreCase) || !room.IsAdmin(player.PlayerId))
        {
            await SendError("Solo el anfitrión puede cambiar el modo de su sala.");
            return;
        }
        if (!room.TrySetRedactorCanGuess(enabled))
        {
            await SendError("El modo de juego solo se puede cambiar en la sala de espera.");
            return;
        }
        await BroadcastState(room, excludePlayerId: null);
    }

    // ── Expulsar jugador (solo anfitrión, solo en lobby) ───────────────────

    public async Task KickPlayer(string targetPlayerId)
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;

        var rejection = room.TryKickPlayer(player.PlayerId, targetPlayerId, out var kicked);

        if (rejection != KickRejection.None || kicked is null)
        {
            await SendError(rejection switch
            {
                KickRejection.NotAdmin => "Solo el anfitrión puede expulsar jugadores.",
                KickRejection.NotInLobby => "Solo puedes expulsar a alguien antes de empezar la partida.",
                KickRejection.CannotKickSelf => "No puedes expulsarte a ti mismo. Usa «Salir».",
                _ => "Ese jugador ya no está en la sala.",
            });
            return;
        }

        // Avisar al expulsado antes de sacarlo del grupo para que reciba el evento.
        if (!string.IsNullOrEmpty(kicked.ConnectionId))
        {
            await Clients.Client(kicked.ConnectionId)
                .SendAsync("Kicked", "El anfitrión te ha sacado de la sala.");
            await Groups.RemoveFromGroupAsync(kicked.ConnectionId, room.Code);
        }

        await Clients.Group(room.Code).SendAsync("PlayerKicked", kicked.Name);
        await BroadcastState(room, excludePlayerId: null);

        _logger.LogInformation(
            "Anfitrión {Admin} expulsó a {Target} de la sala {Code}",
            player.Name, kicked.Name, room.Code);
    }

    // ── Enviar pregunta (Redactor) ─────────────────────────────────────────

    public async Task SubmitQuestion(string question)
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;

        if (string.IsNullOrWhiteSpace(question) || question.Trim().Length < 5)
        {
            await SendError("La pregunta es demasiado corta. Sé más específico.");
            return;
        }

        if (question.Length > 300)
        {
            await SendError("La pregunta es demasiado larga (máx 300 caracteres).");
            return;
        }

        // Pre-cálculo en segundo plano: la consulta a Gemini arranca aquí, sin
        // bloquear al Redactor ni al Hub. La tarea queda guardada en la sala y
        // FinalizeRoundAsync la recoge cuando llegue la última estimación. Así la
        // latencia de la IA se solapa con el tiempo que los jugadores tardan en
        // escribir, en lugar de sumarse al final y provocar 504 en el proxy.
        if (!room.TrySubmitQuestion(player.PlayerId, question, StartAnswerLookup))
        {
            await SendError("No puedes enviar la pregunta ahora (fase incorrecta o no eres el Redactor).");
            return;
        }

        // Broadcast inmediato para que los estimadores vean la pregunta y empiecen a escribir
        await BroadcastState(room, excludePlayerId: null);

        _logger.LogInformation("Pregunta enviada en sala {Code}: {Q}", room.Code, question);
    }

    /// <summary>
    /// Lanza la consulta a Gemini en el thread pool y devuelve la tarea sin esperarla.
    /// Solo captura servicios singleton (_gemini, _logger): nunca Context ni Clients,
    /// porque el Hub se destruye al terminar la invocación de SubmitQuestion.
    /// La tarea nunca falla: GetNumericAnswerAsync ya convierte timeouts y errores
    /// en un GeminiAnswerResult no verificable.
    /// </summary>
    private Task<GeminiAnswerResult> StartAnswerLookup(string question)
    {
        var gemini = _gemini;
        var logger = _logger;
        var startedAt = DateTimeOffset.UtcNow;

        return Task.Run(async () =>
        {
            using var cts = new CancellationTokenSource(AnswerLookupTimeout);
            try
            {
                var result = await gemini.GetNumericAnswerAsync(question, cts.Token);
                logger.LogInformation(
                    "Pre-cálculo IA completado en {Ms} ms (verificable: {Ok}) para: {Q}",
                    (DateTimeOffset.UtcNow - startedAt).TotalMilliseconds, result.IsVerifiable, question);
                return result;
            }
            catch (OperationCanceledException)
            {
                return GeminiAnswerResult.Unverifiable("Timeout al consultar la IA.");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Pre-cálculo IA falló para: {Q}", question);
                return GeminiAnswerResult.Unverifiable($"Error de IA: {ex.Message}");
            }
        });
    }

    /// <summary>Tiempo máximo de la consulta numérica a la IA (pre-cálculo o fallback).</summary>
    private static readonly TimeSpan AnswerLookupTimeout = TimeSpan.FromSeconds(20);

    // ── Enviar estimación ──────────────────────────────────────────────────

    public async Task SubmitGuess(double guess)
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;

        if (double.IsNaN(guess) || double.IsInfinity(guess))
        {
            await SendError("Estimación inválida.");
            return;
        }

        var (ok, allSubmitted) = room.TrySubmitGuess(player.PlayerId, guess);

        if (!ok)
        {
            await SendError("No puedes enviar esa estimación: comprueba el modo, la fase y que no hayas respondido ya (máximo ±1.000 billones).");
            return;
        }

        // Confirmar solo al jugador (no revelar a otros)
        await Clients.Caller.SendAsync("GuessAcknowledged");

        // Broadcast del contador (sin revelar estimaciones individuales)
        await BroadcastState(room, excludePlayerId: null);

        if (allSubmitted)
        {
            await FinalizeRoundAsync(room);
        }
    }

    // ── Forzar cierre de ronda (host o timeout) ────────────────────────────

    public async Task RequestResults()
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;

        if (room.Phase != GamePhase.CollectingGuesses)
        {
            await SendError("No hay ronda activa para cerrar.");
            return;
        }

        // Solo el Redactor o el anfitrión pueden forzar el cierre
        var isHost = room.IsAdmin(player.PlayerId);
        var isRedactor = player.PlayerId == room.RedactorPlayerId;

        if (!isHost && !isRedactor)
        {
            await SendError("Solo el Redactor o el anfitrión pueden cerrar la ronda.");
            return;
        }

        if (room.ToDto(player.PlayerId).GuessesSubmitted == 0)
        {
            await SendError("Hace falta al menos una estimación para mostrar resultados.");
            return;
        }
        await FinalizeRoundAsync(room);
    }

    public async Task DistributeDrinks(string targetPlayerId, int amount)
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;
        if (!room.TryDistributeDrinks(player.PlayerId, targetPlayerId, amount))
        {
            await SendError("Solo los ganadores pueden repartir sus tragos pendientes a otro jugador durante los resultados.");
            return;
        }
        await BroadcastState(room, excludePlayerId: null);
    }

    // ── Siguiente ronda ────────────────────────────────────────────────────

    public async Task NextRound()
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;

        if (!room.IsAdmin(player.PlayerId))
        {
            await SendError("Solo el anfitrión puede avanzar la ronda.");
            return;
        }
        if (room.Phase != GamePhase.ShowingResults)
        {
            await SendError("Espera a los resultados antes de avanzar.");
            return;
        }
        if (room.HasPendingDistribution)
        {
            await SendError("Espera a que los ganadores conectados terminen de repartir sus tragos.");
            return;
        }
        bool hasMore = room.TryAdvanceRound();

        if (!hasMore)
        {
            if (room.Phase != GamePhase.Closed) return;
            await BroadcastState(room, excludePlayerId: null);
            // Juego terminado
            await Clients.Group(room.Code).SendAsync("RoomClosed", "¡Juego terminado! Gracias por jugar.");
            _roomManager.RemoveRoom(room.Code);
            return;
        }

        await BroadcastState(room, excludePlayerId: null);
    }

    // ── Salir de sala ──────────────────────────────────────────────────────

    public async Task LeaveRoom()
    {
        var roomCode = Context.Items[RoomCodeKey] as string;
        if (roomCode is null) return;

        var playerId = Context.Items[PlayerIdKey] as string;
        var room = _roomManager.GetRoom(roomCode);

        // Salida voluntaria: libera el asiento de verdad (a diferencia de una
        // desconexión, que lo reserva). Así el nombre vuelve a estar libre y,
        // si se iba el anfitrión, la sala promociona a otro.
        if (room is not null && playerId is not null &&
            room.Players.Any(p => p.PlayerId == playerId && p.ConnectionId == Context.ConnectionId) && room.RemovePlayer(playerId))
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomCode);
            await BroadcastState(room, excludePlayerId: null);
            if (room.ReadyToFinalize) await FinalizeRoundAsync(room);
            if (room.Players.Count == 0) _roomManager.RemoveRoom(room.Code);
        }
        else
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomCode);
        }

        Context.Items.Remove(RoomCodeKey);
        Context.Items.Remove(PlayerIdKey);
    }

    // ── Lógica de finalización de ronda ────────────────────────────────────

    private async Task FinalizeRoundAsync(Room room)
    {
        if (!await room.FinalizationGate.WaitAsync(0)) return;
        RoundResult? result;
        try { result = await FinalizeRoundCoreAsync(room); }
        finally { room.FinalizationGate.Release(); }
        if (result is null) return;

        var loser = result.Ranking.LastOrDefault(r => r.Rank > 1);
        if (loser is not null)
        {
            using var commentTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var comment = await _gemini.GetSarcasticCommentAsync(
                result.LoserName, loser.Guess, result.CorrectAnswer, result.Question,
                room.IsAlcoholFreeRoom, commentTimeout.Token);
            if (room.TrySetSarcasticComment(result.RoundNumber, comment))
                await BroadcastState(room, excludePlayerId: null);
        }
    }

    private async Task<RoundResult?> FinalizeRoundCoreAsync(Room room)
    {
        if (room.Phase != GamePhase.CollectingGuesses) return null;

        var question = room.CurrentQuestion ?? string.Empty;

        // Recuperar la respuesta pre-calculada al enviar la pregunta. Si la IA ya
        // terminó (lo habitual), el await es instantáneo; si no, solo esperamos el
        // tiempo restante en vez de los 15-20 s completos.
        var pending = room.GetPendingAnswerTask();
        if (pending is null)
        {
            // Sin pre-cálculo (p. ej. la pregunta cambió tras un reset): fallback síncrono
            _logger.LogWarning("Sala {Code} sin pre-cálculo de IA; consultando ahora.", room.Code);
            pending = StartAnswerLookup(question);
        }
        else
        {
            _logger.LogInformation(
                "Sala {Code}: pre-cálculo IA {Estado}.",
                room.Code, pending.IsCompleted ? "ya disponible" : "aún en curso, esperando");
        }

        GeminiAnswerResult answerResult;
        try
        {
            // El timeout está garantizado dentro de la tarea; WaitAsync es solo una
            // red de seguridad para no colgar nunca la invocación del Hub.
            answerResult = await pending.WaitAsync(AnswerLookupTimeout);
        }
        catch (TimeoutException)
        {
            answerResult = GeminiAnswerResult.Unverifiable("Timeout al consultar la IA.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error recuperando la respuesta de la IA en sala {Code}", room.Code);
            answerResult = GeminiAnswerResult.Unverifiable($"Error de IA: {ex.Message}");
        }

        if (!answerResult.IsVerifiable)
        {
            // Pregunta no verificable: notificar y pedir nueva pregunta
            _logger.LogWarning("Pregunta no verificable en sala {Code}: {Reason}",
                room.Code, answerResult.Explanation);

            await Clients.Group(room.Code).SendAsync(
                "Error",
                "La IA no pudo resolver esta pregunta. " +
                "El Redactor debe reformular la pregunta con datos más concretos.");

            // Revertir a WritingQuestion para que el Redactor reformule
            // (no avanzamos de fase; el estado sigue en CollectingGuesses)
            // En su lugar, notificamos y dejamos que el Redactor envíe nueva pregunta
            // mediante un reset controlado:
            await ResetToWritingQuestionAsync(room);
            return null;
        }

        var result = room.FinalizeRound(answerResult.Value, answerResult.Source, sarcasticComment: string.Empty);
        if (result is null)
        {
            await SendError("No quedan estimaciones para calcular los resultados. Envía una respuesta primero.");
            return null;
        }

        // Los resultados se publican antes del comentario para no retrasar el veredicto.
        await BroadcastState(room, excludePlayerId: null);
        _logger.LogInformation(
            "Ronda {Round} finalizada en sala {Code}. Respuesta: {Answer} ({Source})",
            result.RoundNumber, room.Code, answerResult.Value, answerResult.Source);
        return result;
    }

    private async Task ResetToWritingQuestionAsync(Room room)
    {
        // Hack controlado: revertir fase a WritingQuestion sin avanzar ronda
        // Esto requiere acceso al estado interno; lo hacemos a través de un método público
        // que solo existe para este caso de error de IA.
        // El estado de estimaciones se limpia para que los jugadores puedan re-estimar.
        room.ResetGuessesForRetry();
        await BroadcastState(room, excludePlayerId: null);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private async Task<(Room? Room, Player? Player)> GetRoomAndPlayerOrError()
    {
        var roomCode = Context.Items[RoomCodeKey] as string;
        var playerId = Context.Items[PlayerIdKey] as string;

        if (roomCode is null || playerId is null)
        {
            await SendError("No estás en ninguna sala.");
            return (null, null);
        }

        var room = _roomManager.GetRoom(roomCode);
        if (room is null)
        {
            await SendError("La sala ya no existe.");
            return (null, null);
        }

        var player = room.Players.FirstOrDefault(p => p.PlayerId == playerId);
        if (player is null || player.ConnectionId != Context.ConnectionId)
        {
            await SendError("No se encontró tu perfil en la sala.");
            return (null, null);
        }

        return (room, player);
    }

    private async Task BroadcastState(Room room, string? excludePlayerId)
    {
        // Enviar estado personalizado a cada jugador (privacidad de estimaciones)
        var tasks = room.Players
            .Where(p => p.IsConnected)
            .Select(p => Clients.Client(p.ConnectionId)
                .SendAsync("GameStateUpdated", room.ToDto(p.PlayerId)));

        await Task.WhenAll(tasks);
    }

    private async Task SendError(string message)
    {
        await Clients.Caller.SendAsync("Error", message);
    }

    private void StoreContext(string roomCode, string playerId)
    {
        Context.Items[RoomCodeKey] = roomCode;
        Context.Items[PlayerIdKey] = playerId;
    }

    private Player NewPlayer(string name, bool alcoholFree, string? playerId) =>
        new()
        {
            Name = name.Trim(),
            ConnectionId = Context.ConnectionId,
            AlcoholFree = alcoholFree,
            PlayerId = string.IsNullOrWhiteSpace(playerId)
                ? Guid.NewGuid().ToString("N")
                : playerId.Trim()
        };

    /// <summary>Traduce el motivo del rechazo a un mensaje accionable para el jugador.</summary>
    private static string DescribeRejection(JoinRejection rejection, string name) => rejection switch
    {
        JoinRejection.NameTaken => $"Ya hay alguien llamado «{name}» en la sala. Elige otro nombre.",
        JoinRejection.RoomFull => $"La sala está completa ({Room.MaxPlayers} jugadores).",
        JoinRejection.RoomClosed => "Esa sala ya se ha cerrado.",
        JoinRejection.GameStarted => "La partida ya ha empezado. Únete a una nueva sala.",
        JoinRejection.AlreadyJoined => "Ya estás dentro de esta sala.",
        _ => "No se pudo unir a la sala. Inténtalo de nuevo.",
    };

    private static bool ValidateName(string name, out string error)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            error = "El nombre no puede estar vacío.";
            return false;
        }

        name = name.Trim();
        if (name.Length < 2)
        {
            error = "El nombre debe tener al menos 2 caracteres.";
            return false;
        }

        if (name.Length > 20)
        {
            error = "El nombre no puede superar los 20 caracteres.";
            return false;
        }

        error = string.Empty;
        return true;
    }
}
