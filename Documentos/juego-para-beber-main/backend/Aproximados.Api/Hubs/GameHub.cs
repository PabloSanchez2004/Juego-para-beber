using Aproximados.Api.Models;
using Aproximados.Api.Services;
using Microsoft.AspNetCore.SignalR;

namespace Aproximados.Api.Hubs;

/// <summary>
/// Hub SignalR principal del juego Aproximados.
///
/// Protocolo cliente→servidor (métodos invocables):
///   CreateRoom(name, alcoholFree)         → RoomCreated | Error
///   JoinRoom(code, name, alcoholFree)     → JoinedRoom | Error
///   Reconnect(code, playerId)             → ReconnectedRoom | Error
///   StartGame(maxRounds)                  → GameStateUpdated (broadcast)
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
                var player = room.Players.FirstOrDefault(p => p.PlayerId == playerId);
                room.MarkDisconnected(Context.ConnectionId);

                if (player is not null)
                {
                    await Clients.Group(roomCode).SendAsync(
                        "PlayerDisconnected", player.Name);

                    _logger.LogInformation(
                        "Jugador {Name} desconectado de sala {Code}. Grace period: {Seconds}s",
                        player.Name, roomCode, Room.ReconnectGracePeriod.TotalSeconds);
                }
            }
        }

        await base.OnDisconnectedAsync(exception);
    }

    // ── Crear sala ─────────────────────────────────────────────────────────

    public async Task CreateRoom(string name, bool alcoholFree)
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

            var player = new Player
            {
                Name = name.Trim(),
                ConnectionId = Context.ConnectionId,
                AlcoholFree = alcoholFree
            };

            if (!room.TryAddPlayer(player))
            {
                _roomManager.RemoveRoom(room.Code);
                await SendError("Error al crear la sala. Inténtalo de nuevo.");
                return;
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, room.Code);
            StoreContext(room.Code, player.PlayerId);

            var state = room.ToDto(player.PlayerId);
            await Clients.Caller.SendAsync("RoomCreated", room.Code, player.PlayerId, state);

            _logger.LogInformation("Sala {Code} creada por {Name}", room.Code, name);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "CreateRoom falló para {Name}", name);
            await SendError($"Error al crear la sala: {ex.Message}");
        }
    }

    // ── Unirse a sala ──────────────────────────────────────────────────────

    public async Task JoinRoom(string code, string name, bool alcoholFree)
    {
        if (!ValidateName(name, out var nameError))
        {
            await SendError(nameError);
            return;
        }

        code = code.Trim().ToUpperInvariant();
        var room = _roomManager.GetRoom(code);

        if (room is null)
        {
            await SendError($"No existe ninguna sala con el código «{code}». Revísalo.");
            return;
        }

        if (room.Phase != GamePhase.Lobby)
        {
            await SendError("La partida ya ha empezado. Espera a la siguiente ronda.");
            return;
        }

        var player = new Player
        {
            Name = name.Trim(),
            ConnectionId = Context.ConnectionId,
            AlcoholFree = alcoholFree
        };

        if (!room.TryAddPlayer(player))
        {
            await SendError("La sala está llena o ya existe un jugador con ese nombre.");
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        StoreContext(code, player.PlayerId);

        var state = room.ToDto(player.PlayerId);
        await Clients.Caller.SendAsync("JoinedRoom", player.PlayerId, state);

        // Notificar al resto de la sala
        await BroadcastState(room, excludePlayerId: null);

        _logger.LogInformation("Jugador {Name} se unió a sala {Code}", name, code);
    }

    // ── Reconexión ─────────────────────────────────────────────────────────

    public async Task Reconnect(string code, string playerId)
    {
        code = code.Trim().ToUpperInvariant();
        var room = _roomManager.GetRoom(code);

        if (room is null)
        {
            await SendError("La sala ya no existe. Crea una nueva.");
            return;
        }

        // Verificar que el jugador existe y no ha expirado
        var player = room.Players.FirstOrDefault(p => p.PlayerId == playerId);
        if (player is null)
        {
            await SendError("Tu sesión expiró. Únete de nuevo con tu nombre.");
            return;
        }

        // Detectar suplantación: si el jugador ya está conectado con otro connectionId
        if (player.IsConnected && player.ConnectionId != Context.ConnectionId)
        {
            await SendError("Este jugador ya está conectado desde otro dispositivo.");
            return;
        }

        if (!room.TryReconnectPlayer(playerId, Context.ConnectionId))
        {
            await SendError("No se pudo reconectar. La sala puede haber cerrado.");
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        StoreContext(code, playerId);

        var state = room.ToDto(playerId);
        await Clients.Caller.SendAsync("ReconnectedRoom", state);
        await Clients.Group(code).SendAsync("PlayerReconnected", player.Name);

        _logger.LogInformation("Jugador {Name} reconectado a sala {Code}", player.Name, code);
    }

    // ── Iniciar juego ──────────────────────────────────────────────────────

    public async Task StartGame(int maxRounds = Room.DefaultMaxRounds)
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;

        maxRounds = Math.Clamp(maxRounds, 1, 20);

        if (!room.TryStartGame(maxRounds, room.IsAlcoholFreeRoom))
        {
            await SendError("No se puede iniciar: necesitas al menos 2 jugadores conectados.");
            return;
        }

        await BroadcastState(room, excludePlayerId: null);
        _logger.LogInformation("Juego iniciado en sala {Code}, {Rounds} rondas", room.Code, maxRounds);
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
            await SendError("No puedes enviar estimación ahora (ya enviaste, eres Redactor, o fase incorrecta).");
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

        // Solo el Redactor o el primer jugador (host) puede forzar el cierre
        var isHost = room.Players.OrderBy(p => p.Name).First().PlayerId == player.PlayerId;
        var isRedactor = player.PlayerId == room.RedactorPlayerId;

        if (!isHost && !isRedactor)
        {
            await SendError("Solo el Redactor o el anfitrión pueden cerrar la ronda.");
            return;
        }

        await FinalizeRoundAsync(room);
    }

    // ── Siguiente ronda ────────────────────────────────────────────────────

    public async Task NextRound()
    {
        var (room, player) = await GetRoomAndPlayerOrError();
        if (room is null || player is null) return;

        bool hasMore = room.TryAdvanceRound();

        if (!hasMore)
        {
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

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomCode);
        Context.Items.Remove(RoomCodeKey);
        Context.Items.Remove(PlayerIdKey);
    }

    // ── Lógica de finalización de ronda ────────────────────────────────────

    private async Task FinalizeRoundAsync(Room room)
    {
        if (room.Phase != GamePhase.CollectingGuesses) return;

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
                $"⚠️ La IA no pudo verificar la respuesta: {answerResult.Explanation}. " +
                "El Redactor debe reformular la pregunta con datos más concretos.");

            // Revertir a WritingQuestion para que el Redactor reformule
            // (no avanzamos de fase; el estado sigue en CollectingGuesses)
            // En su lugar, notificamos y dejamos que el Redactor envíe nueva pregunta
            // mediante un reset controlado:
            await ResetToWritingQuestionAsync(room);
            return;
        }

        // El comentario sarcástico de la IA se retiró de la pantalla de resultados,
        // así que ya no se hace la segunda llamada a Gemini al cerrar la ronda
        // (era hasta 10 s más de espera para los jugadores). El campo se mantiene
        // vacío en el DTO por compatibilidad.
        var result = room.FinalizeRound(answerResult.Value, answerResult.Source, sarcasticComment: string.Empty);

        if (result is null)
        {
            await SendError("Error al calcular resultados. Inténtalo de nuevo.");
            return;
        }

        // Broadcast de resultados (ahora sí se revelan todas las estimaciones)
        await BroadcastState(room, excludePlayerId: null);

        _logger.LogInformation(
            "Ronda {Round} finalizada en sala {Code}. Respuesta: {Answer} ({Source})",
            result.RoundNumber, room.Code, answerResult.Value, answerResult.Source);
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
        if (player is null)
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
