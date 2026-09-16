using System.Collections.Concurrent;
using Aproximados.Api.Services;

namespace Aproximados.Api.Models;

/// <summary>
/// Sala de juego. Todo el estado mutable se protege con _lock.
/// ConcurrentDictionary solo garantiza operaciones atómicas de diccionario;
/// las transiciones de fase y la lógica de ronda requieren lock explícito.
/// </summary>
public sealed class Room
{
    internal SemaphoreSlim FinalizationGate { get; } = new(1, 1);
    // ── Constantes ─────────────────────────────────────────────────────────

    public const int MaxPlayers = 12;
    public const int MinPlayersToStart = 2;
    public const int DefaultMaxRounds = 10;

    /// <summary>Tiempo máximo de reconexión antes de expulsar al jugador.</summary>
    public static readonly TimeSpan ReconnectGracePeriod = TimeSpan.FromMinutes(15);

    /// <summary>Tiempo de inactividad antes de cerrar la sala automáticamente.</summary>
    public static readonly TimeSpan RoomIdleTimeout = TimeSpan.FromMinutes(60);

    // ── Identidad ──────────────────────────────────────────────────────────

    public string Code { get; init; } = string.Empty;

    // ── Jugadores ──────────────────────────────────────────────────────────

    /// <summary>
    /// Jugadores indexados por PlayerId estable.
    /// Acceso de lectura rápida sin lock; escritura siempre bajo _lock.
    /// </summary>
    private readonly ConcurrentDictionary<string, Player> _players = new();

    // ── Estado de juego ────────────────────────────────────────────────────

    private readonly object _lock = new();

    private GamePhase _phase = GamePhase.Lobby;
    private int _roundNumber;
    private string? _currentQuestion;
    private string? _redactorPlayerId;
    private int _redactorIndex; // solo ronda 1 (o si no hay ranking usable)
    private RoundResult? _lastResult;
    private DateTimeOffset _lastActivity = DateTimeOffset.UtcNow;

    /// <summary>
    /// Respuesta de la IA pre-calculada en segundo plano para la pregunta actual.
    /// Se lanza en <see cref="TrySubmitQuestion"/> y se consume al finalizar la ronda,
    /// de modo que la latencia de Gemini se solapa con el tiempo que tardan los
    /// jugadores en escribir sus estimaciones.
    /// </summary>
    private PendingAnswer? _pendingAnswer;

    public int MaxRounds { get; private set; } = DefaultMaxRounds;
    public bool IsAlcoholFreeRoom { get; private set; }
    public bool RedactorCanGuess { get; private set; }

    // ── Propiedades de solo lectura (seguras sin lock para snapshot) ───────

    public GamePhase Phase => _phase;
    public int RoundNumber => _roundNumber;
    public string? CurrentQuestion => _currentQuestion;
    public string? RedactorPlayerId => _redactorPlayerId;
    public RoundResult? LastResult => _lastResult;
    public DateTimeOffset LastActivity => _lastActivity;

    public IReadOnlyCollection<Player> Players => _players.Values.ToList().AsReadOnly();

    // ── Operaciones atómicas ───────────────────────────────────────────────

    /// <summary>
    /// Intenta añadir un jugador y explica por qué se rechaza.
    /// El primero en entrar (quien crea la sala) queda como anfitrión.
    /// </summary>
    public JoinRejection AddPlayer(Player player)
    {
        lock (_lock)
        {
            if (_phase == GamePhase.Closed) return JoinRejection.RoomClosed;
            if (_phase != GamePhase.Lobby) return JoinRejection.GameStarted;
            if (_players.ContainsKey(player.PlayerId)) return JoinRejection.AlreadyJoined;
            if (_players.Count >= MaxPlayers) return JoinRejection.RoomFull;
            if (_players.Values.Any(p => p.Name.Equals(player.Name, StringComparison.OrdinalIgnoreCase)))
                return JoinRejection.NameTaken;

            // Quien crea la sala manda: es el único que puede empezar y expulsar.
            player.IsAdmin = _players.IsEmpty;

            _players[player.PlayerId] = player;
            _lastActivity = DateTimeOffset.UtcNow;
            EnsureAdmin();
            return JoinRejection.None;
        }
    }

    /// <summary>Azúcar retrocompatible sobre <see cref="AddPlayer"/>.</summary>
    public bool TryAddPlayer(Player player) => AddPlayer(player) == JoinRejection.None;

    /// <summary>
    /// True si el nombre ya lo usa otro jugador de la sala (sin distinguir mayúsculas).
    /// </summary>
    public bool IsNameTaken(string name) =>
        _players.Values.Any(p => p.Name.Equals(name.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>PlayerId del anfitrión actual, o null si la sala está vacía.</summary>
    public string? AdminPlayerId =>
        _players.Values.FirstOrDefault(p => p.IsAdmin)?.PlayerId;

    /// <summary>True si ese jugador es el anfitrión.</summary>
    public bool IsAdmin(string playerId) =>
        _players.TryGetValue(playerId, out var p) && p.IsAdmin;

    /// <summary>
    /// El anfitrión expulsa a otro jugador. Solo desde el lobby: a mitad de partida
    /// sacar a alguien descuadraría el ranking y el recuento de estimaciones.
    /// </summary>
    public KickRejection TryKickPlayer(string adminPlayerId, string targetPlayerId, out Player? kicked)
    {
        lock (_lock)
        {
            kicked = null;

            if (!IsAdmin(adminPlayerId)) return KickRejection.NotAdmin;
            if (_phase != GamePhase.Lobby) return KickRejection.NotInLobby;
            if (adminPlayerId == targetPlayerId) return KickRejection.CannotKickSelf;
            if (!_players.TryRemove(targetPlayerId, out var target)) return KickRejection.TargetNotFound;

            kicked = target;
            _lastActivity = DateTimeOffset.UtcNow;
            EnsureAdmin();
            return KickRejection.None;
        }
    }

    /// <summary>
    /// Saca a un jugador por decisión propia (salir de la sala).
    /// Devuelve true si estaba dentro.
    /// </summary>
    public bool RemovePlayer(string playerId)
    {
        lock (_lock)
        {
            if (!_players.TryRemove(playerId, out _)) return false;

            _lastActivity = DateTimeOffset.UtcNow;
            RecoverAvailablePlayers();
            return true;
        }
    }

    /// <summary>
    /// Garantiza que siempre haya exactamente un anfitrión. Si el actual se fue,
    /// promociona al jugador conectado más antiguo por nombre (criterio estable).
    /// Debe llamarse bajo _lock.
    /// </summary>
    private void EnsureAdmin()
    {
        var admins = _players.Values.Where(p => p.IsAdmin).ToList();
        if (admins.Count == 1 && (admins[0].IsConnected || !_players.Values.Any(p => p.IsConnected))) return;

        foreach (var p in admins)
            p.IsAdmin = false;

        var heir = _players.Values.Where(p => p.IsConnected).OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase).FirstOrDefault()
                   ?? _players.Values.OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase).FirstOrDefault();

        if (heir is not null) heir.IsAdmin = true;
    }

    // Mantiene los controles accesibles tras una desconexión o una salida.
    // En una pregunta ya enviada conservamos al redactor para no alterar quién estima.
    private void RecoverAvailablePlayers()
    {
        EnsureAdmin();
        if (_phase == GamePhase.WritingQuestion &&
            (!_players.TryGetValue(_redactorPlayerId ?? string.Empty, out var redactor) || !redactor.IsConnected))
            AssignRedactor();
    }

    public bool TrySetRedactorCanGuess(bool enabled)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.Lobby) return false;
            RedactorCanGuess = enabled;
            _lastActivity = DateTimeOffset.UtcNow;
            return true;
        }
    }

    /// <summary>
    /// Fija el número de rondas mientras la sala está en Lobby.
    /// El host lo elige al crear; StartGame lo respeta.
    /// </summary>
    public bool TrySetMaxRounds(int maxRounds)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.Lobby) return false;
            MaxRounds = Math.Clamp(maxRounds, 1, 20);
            _lastActivity = DateTimeOffset.UtcNow;
            return true;
        }
    }

    /// <summary>
    /// Reconecta un jugador existente con un nuevo ConnectionId.
    /// Devuelve false si el PlayerId no existe o la sala está cerrada.
    /// </summary>
    public bool TryReconnectPlayer(string playerId, string newConnectionId)
    {
        lock (_lock)
        {
            if (_phase == GamePhase.Closed) return false;
            if (!_players.TryGetValue(playerId, out var player)) return false;

            player.ConnectionId = newConnectionId;
            player.IsConnected = true;
            player.DisconnectedAt = null;
            RecoverAvailablePlayers();
            _lastActivity = DateTimeOffset.UtcNow;
            return true;
        }
    }

    /// <summary>Marca al jugador como desconectado.</summary>
    public void MarkDisconnected(string connectionId)
    {
        TryMarkDisconnected(playerId: null, connectionId);
    }

    /// <summary>
    /// Marca desconexión solo si <paramref name="connectionId"/> sigue siendo
    /// el ConnectionId actual. Si el jugador ya hizo RejoinRoom con uno nuevo,
    /// el OnDisconnected de la conexión vieja no le pisa el asiento.
    /// </summary>
    public bool TryMarkDisconnected(string? playerId, string connectionId)
    {
        lock (_lock)
        {
            Player? player = playerId is not null && _players.TryGetValue(playerId, out var byId)
                ? byId
                : _players.Values.FirstOrDefault(p => p.ConnectionId == connectionId);

            if (player is null) return false;
            if (player.ConnectionId != connectionId) return false;

            player.IsDisconnected = true;
            player.DisconnectedAt = DateTimeOffset.UtcNow;
            RecoverAvailablePlayers();
            _lastActivity = DateTimeOffset.UtcNow;
            return true;
        }
    }

    /// <summary>
    /// Expulsa jugadores desconectados que superaron el grace period.
    /// Devuelve los PlayerIds expulsados.
    /// </summary>
    public IReadOnlyList<string> PurgeTimedOutPlayers()
    {
        lock (_lock)
        {
            var now = DateTimeOffset.UtcNow;
            var timedOut = _players.Values
                .Where(p => !p.IsConnected && p.DisconnectedAt.HasValue
                            && now - p.DisconnectedAt.Value > ReconnectGracePeriod)
                .Select(p => p.PlayerId)
                .ToList();

            foreach (var id in timedOut)
                _players.TryRemove(id, out _);

            if (timedOut.Count > 0) RecoverAvailablePlayers();

            return timedOut;
        }
    }

    /// <summary>
    /// Intenta iniciar el juego. Devuelve false si no hay suficientes jugadores
    /// o la fase no es Lobby.
    /// </summary>
    public bool TryStartGame(int maxRounds, bool alcoholFree)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.Lobby) return false;
            var connected = _players.Values.Count(p => p.IsConnected);
            if (connected < MinPlayersToStart) return false;

            MaxRounds = Math.Clamp(maxRounds, 1, 20);
            IsAlcoholFreeRoom = alcoholFree;
            _roundNumber = 0;
            _redactorIndex = 0;
            _phase = GamePhase.WritingQuestion;
            _roundNumber = 1;
            _pendingAnswer = null;
            AssignRedactor();
            _lastActivity = DateTimeOffset.UtcNow;
            return true;
        }
    }

    /// <summary>
    /// Registra la pregunta del Redactor y avanza a CollectingGuesses.
    /// Devuelve false si la fase o el jugador no son correctos.
    /// </summary>
    /// <param name="startAnswerLookup">
    /// Fábrica que lanza (sin bloquear) la consulta a la IA para la pregunta ya
    /// normalizada. La tarea resultante se guarda en la sala y se recupera con
    /// <see cref="GetPendingAnswerTask"/> al finalizar la ronda. Se invoca dentro
    /// del lock para que la transición de fase y el arranque del pre-cálculo sean
    /// atómicos: ningún jugador puede cerrar la ronda antes de que exista la tarea.
    /// </param>
    public bool TrySubmitQuestion(
        string playerId,
        string question,
        Func<string, Task<GeminiAnswerResult>>? startAnswerLookup = null)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.WritingQuestion) return false;
            if (_redactorPlayerId != playerId || !_players.TryGetValue(playerId, out var redactor) || !redactor.IsConnected) return false;
            if (string.IsNullOrWhiteSpace(question)) return false;

            var normalized = question.Trim();
            _currentQuestion = normalized;
            _phase = GamePhase.CollectingGuesses;
            _pendingAnswer = startAnswerLookup is null
                ? null
                : new PendingAnswer(normalized, startAnswerLookup(normalized));
            _lastActivity = DateTimeOffset.UtcNow;
            return true;
        }
    }

    /// <summary>
    /// Devuelve la tarea de pre-cálculo de la IA para la pregunta actual, o null
    /// si no existe o corresponde a una pregunta distinta (p. ej. tras un reset).
    /// </summary>
    public Task<GeminiAnswerResult>? GetPendingAnswerTask()
    {
        lock (_lock)
        {
            if (_pendingAnswer is null) return null;
            if (_currentQuestion is null) return null;
            if (!string.Equals(_pendingAnswer.Question, _currentQuestion, StringComparison.Ordinal))
                return null;

            return _pendingAnswer.Task;
        }
    }

    /// <summary>
    /// Registra la estimación de un jugador.
    /// Devuelve (ok, allSubmitted).
    /// </summary>
    public (bool Ok, bool AllSubmitted) TrySubmitGuess(string playerId, double guess)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.CollectingGuesses || !double.IsFinite(guess) || Math.Abs(guess) > 1e15) return (false, false);
            if (!_players.TryGetValue(playerId, out var player) || !player.IsConnected) return (false, false);
            if (!IsEstimator(player)) return (false, false);
            if (player.Guess.HasValue) return (false, false); // ya envió

            player.Guess = guess;
            _lastActivity = DateTimeOffset.UtcNow;

            return (true, AllGuessesSubmitted());
        }
    }

    private bool IsEstimator(Player p) => RedactorCanGuess || p.PlayerId != _redactorPlayerId;

    // Si alguien se desconecta tras responder, su respuesta sigue en el total.
    private int CountExpectedGuesses() =>
        _players.Values.Count(p => IsEstimator(p) && (p.IsConnected || p.Guess.HasValue));

    private int CountSubmittedGuesses() =>
        _players.Values.Count(p => IsEstimator(p) && p.Guess.HasValue);

    private bool AllGuessesSubmitted() => CountSubmittedGuesses() > 0 &&
        _players.Values.Where(p => p.IsConnected && IsEstimator(p)).All(p => p.Guess.HasValue);

    public bool ReadyToFinalize
    {
        get { lock (_lock) return _phase == GamePhase.CollectingGuesses && AllGuessesSubmitted(); }
    }

    /// <summary>
    /// Calcula el ranking y aplica castigos. Avanza a ShowingResults.
    /// Devuelve null si la fase no es CollectingGuesses.
    /// </summary>
    public RoundResult? FinalizeRound(double correctAnswer, string answerSource, string sarcasticComment)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.CollectingGuesses || !double.IsFinite(correctAnswer)) return null;

            var estimators = _players.Values
                .Where(p => IsEstimator(p) && p.Guess.HasValue)
                .ToList();

            if (estimators.Count == 0) return null;

            // Calcular error relativo para cada jugador
            var ranked = estimators
                .Select(p => new
                {
                    Player = p,
                    Error = ComputeRelativeError(p.Guess!.Value, correctAnswer)
                })
                .OrderBy(x => x.Error)
                .ThenBy(x => x.Player.Name, StringComparer.OrdinalIgnoreCase) // desempate determinista por nombre
                .ToList();

            // Asignar rangos (empates comparten rango)
            var results = new List<PlayerRoundResult>();
            int rank = 1;
            for (int i = 0; i < ranked.Count; i++)
            {
                if (i > 0 && ranked[i].Error != ranked[i - 1].Error)
                    rank = i + 1;

                var p = ranked[i].Player;
                results.Add(new PlayerRoundResult
                {
                    PlayerId = p.PlayerId,
                    PlayerName = p.Name,
                    Guess = p.Guess!.Value,
                    CorrectAnswer = correctAnswer,
                    RelativeErrorPercent = ranked[i].Error * 100,
                    Rank = rank
                });
            }

            // Mecánica de tragos:
            //   · Ganador (rango 1, el que más se acercó) → reparte 1 trago a quien quiera.
            //   · Perdedor (rango más alto, el que más se alejó) → bebe.
            //   · Si solo hay un estimador (partida de 2) o todos empatan, hay ganador
            //     pero NO perdedor: nadie puede ser a la vez el más cercano y el más lejano.
            var winners = results.Where(r => r.Rank == 1).ToList();
            int maxRank = results.Max(x => x.Rank);
            var losers = maxRank > 1
                ? results.Where(r => r.Rank == maxRank).ToList()
                : new List<PlayerRoundResult>();

            const int winnerDrinks = 1;
            int loserPenalty = losers.Count == 0 ? 0 : losers[0].RelativeErrorPercent >= 1000 ? 2 : 1;
            var otherPlayers = _players.Values.Where(p => p.PlayerId != _redactorPlayerId && (p.IsConnected || p.Guess.HasValue)).ToList();
            int redactorPenalty = otherPlayers.Count > 0 &&
                otherPlayers.All(p => p.Guess.HasValue && ComputeRelativeError(p.Guess.Value, correctAnswer) <= 0.01)
                ? 1 : 0;
            string redactorPenaltyDescription = redactorPenalty > 0
                ? "Demasiado fácil: todos los demás han acertado con un error máximo del 1%. Un trago para el redactor."
                : string.Empty;

            // Aplicar tragos a los jugadores.
            // Bucle por índice: reasignamos results[i] dentro del bucle y un foreach
            // lanzaría InvalidOperationException (colección modificada).
            for (int i = 0; i < results.Count; i++)
            {
                var r = results[i];
                var player = _players[r.PlayerId];
                bool isLoser = losers.Any(l => l.PlayerId == r.PlayerId);

                int drinks = 0;
                string penalty = string.Empty;

                if (isLoser)
                {
                    drinks = loserPenalty;
                    penalty = IsAlcoholFreeRoom || player.AlcoholFree
                        ? $"Te has ido lejos: {drinks} trago(s) de tu bebida sin alcohol."
                        : drinks == 2 ? "Error de al menos el 1000%: 2 tragos." : "El más lejos paga: 1 trago.";
                }

                player.DrinksOwed += drinks;


                // Actualizar resultado con drinks
                results[i] = r with { DrinksThisRound = drinks, PenaltyDescription = penalty };
            }

            // Cada victoria suma un punto; el reparto se registra aparte, al elegir destinatario.
            foreach (var w in winners)
            {
                var player = _players[w.PlayerId];
                player.Score += 1;
            }

            if (redactorPenalty > 0 && _players.TryGetValue(_redactorPlayerId ?? string.Empty, out var author))
            {
                author.DrinksOwed += redactorPenalty;
                var authorIndex = results.FindIndex(r => r.PlayerId == author.PlayerId);
                if (authorIndex >= 0)
                    results[authorIndex] = results[authorIndex] with
                    {
                        DrinksThisRound = results[authorIndex].DrinksThisRound + redactorPenalty,
                        PenaltyDescription = string.Join(" ", new[] { results[authorIndex].PenaltyDescription, redactorPenaltyDescription }.Where(x => x.Length > 0))
                    };
            }
            else redactorPenalty = 0;

            var roundResult = new RoundResult
            {
                RoundNumber = _roundNumber,
                Question = _currentQuestion ?? string.Empty,
                CorrectAnswer = correctAnswer,
                AnswerSource = answerSource,
                Ranking = results.AsReadOnly(),
                SarcasticComment = sarcasticComment,
                WinnerName = string.Join(" y ", winners.Select(w => w.PlayerName)),
                LoserName = string.Join(" y ", losers.Select(l => l.PlayerName)),
                DrinksToDistribute = winnerDrinks,
                LoserPenalty = loserPenalty,
                RedactorPenalty = redactorPenalty,
                RedactorPenaltyDescription = redactorPenalty > 0 ? redactorPenaltyDescription : string.Empty
            };

            _lastResult = roundResult;
            _pendingAnswer = null;
            _phase = GamePhase.ShowingResults;
            _lastActivity = DateTimeOffset.UtcNow;
            return roundResult;
        }
    }

    public bool TryDistributeDrinks(string winnerPlayerId, string targetPlayerId, int amount)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.ShowingResults || _lastResult is null || amount < 1) return false;
            if (!_lastResult.Ranking.Any(r => r.PlayerId == winnerPlayerId && r.Rank == 1)) return false;
            if (winnerPlayerId == targetPlayerId || !_players.TryGetValue(targetPlayerId, out var target)) return false;
            var used = _lastResult.DrinksDistributedByWinner.GetValueOrDefault(winnerPlayerId);
            if (amount > _lastResult.DrinksToDistribute - used) return false;

            target.DrinksOwed += amount;
            var distributed = new Dictionary<string, int>(_lastResult.DrinksDistributedByWinner) { [winnerPlayerId] = used + amount };
            _lastResult = _lastResult with
            {
                DrinksDistributedByWinner = distributed,
                DrinkAssignments = _lastResult.DrinkAssignments.Append(new DrinkAssignment(winnerPlayerId, targetPlayerId, amount)).ToList().AsReadOnly(),
                Ranking = _lastResult.Ranking.Select(r => r.PlayerId == targetPlayerId
                    ? r with { DrinksThisRound = r.DrinksThisRound + amount } : r).ToList().AsReadOnly()
            };
            _lastActivity = DateTimeOffset.UtcNow;
            return true;
        }
    }

    public bool TrySetSarcasticComment(int roundNumber, string comment)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.ShowingResults || _roundNumber != roundNumber || _lastResult is null) return false;
            _lastResult = _lastResult with { SarcasticComment = comment };
            return true;
        }
    }

    /// <summary>
    /// Avanza a la siguiente ronda o cierra el juego si se alcanzó el máximo.
    /// Devuelve true si hay más rondas, false si el juego terminó.
    /// </summary>
    public bool HasPendingDistribution
    {
        get
        {
            lock (_lock)
                return _phase == GamePhase.ShowingResults && _lastResult is not null && _players.Count > 1 &&
                    _lastResult.Ranking.Any(r => r.Rank == 1 && _players.TryGetValue(r.PlayerId, out var winner) && winner.IsConnected &&
                        _lastResult.DrinksDistributedByWinner.GetValueOrDefault(r.PlayerId) < _lastResult.DrinksToDistribute);
        }
    }

    public bool TryAdvanceRound()
    {
        lock (_lock)
        {
            if (_phase != GamePhase.ShowingResults || HasPendingDistribution) return false;

            if (_roundNumber >= MaxRounds)
            {
                _phase = GamePhase.Closed;
                return false;
            }

            _roundNumber++;
            var nextRedactorId = PickNextRedactorPlayerId();

            // IMPORTANTE: limpiar la ronda ANTES de asignar el Redactor.
            // ResetForNewRound() pone Role = Estimator a todos; si se ejecutara
            // después de AssignRedactor() el Redactor quedaría como Estimator,
            // GuessesExpected contaría a todos los jugadores y la ronda nunca
            // cerraría (bug de «espera N respuestas en vez de N-1»).
            foreach (var p in _players.Values)
                p.ResetForNewRound();

            AssignRedactor(nextRedactorId);

            _currentQuestion = null;
            _pendingAnswer = null;
            _phase = GamePhase.WritingQuestion;
            _lastActivity = DateTimeOffset.UtcNow;
            return true;
        }
    }

    /// <summary>Cierra la sala.</summary>
    public void Close()
    {
        lock (_lock)
        {
            _phase = GamePhase.Closed;
        }
    }

    /// <summary>
    /// Limpia estimaciones y vuelve a WritingQuestion cuando la IA no puede verificar.
    /// Solo válido desde CollectingGuesses.
    /// </summary>
    public void ResetGuessesForRetry()
    {
        lock (_lock)
        {
            if (_phase != GamePhase.CollectingGuesses) return;

            foreach (var p in _players.Values)
                p.Guess = null;

            _currentQuestion = null;
            _pendingAnswer = null;
            _phase = GamePhase.WritingQuestion;
            RecoverAvailablePlayers();
            _lastActivity = DateTimeOffset.UtcNow;
        }
    }

    /// <summary>Genera un snapshot del estado para enviar a un cliente específico.</summary>
    public GameStateDto ToDto(string requestingPlayerId)
    {
        lock (_lock)
        {
            var players = _players.Values
                .Select(p => p.ToPublicDto(_phase, requestingPlayerId))
                .ToList();

            // Contador visible: «recibidas / (jugadores conectados - 1)».
            int guessesSubmitted = _phase == GamePhase.CollectingGuesses ? CountSubmittedGuesses() : 0;
            int guessesExpected = _phase == GamePhase.CollectingGuesses ? CountExpectedGuesses() : 0;

            return new GameStateDto
            {
                RoomCode = Code,
                Phase = _phase,
                RoundNumber = _roundNumber,
                CurrentQuestion = _currentQuestion,
                RedactorPlayerId = _redactorPlayerId,
                AdminPlayerId = _players.Values.FirstOrDefault(p => p.IsAdmin)?.PlayerId,
                Players = players.AsReadOnly(),
                LastResult = _lastResult,
                MaxRounds = MaxRounds,
                IsAlcoholFreeRoom = IsAlcoholFreeRoom,
                RedactorCanGuess = RedactorCanGuess,
                GuessesSubmitted = guessesSubmitted,
                GuessesExpected = guessesExpected
            };
        }
    }

    // ── Helpers privados ───────────────────────────────────────────────────

    /// <summary>
    /// El más cercano al valor de la ronda anterior redacta la siguiente.
    /// Empates: el ranking ya está ordenado por error y luego por nombre.
    /// Si el ganador se desconectó, pasa al siguiente más cercano que siga dentro.
    /// </summary>
    private string? PickNextRedactorPlayerId()
    {
        if (_lastResult?.Ranking is null || _lastResult.Ranking.Count == 0)
            return null;

        var connectedIds = _players.Values
            .Where(p => p.IsConnected)
            .Select(p => p.PlayerId)
            .ToHashSet();

        return _lastResult.Ranking
            .Where(r => connectedIds.Contains(r.PlayerId))
            .Select(r => r.PlayerId)
            .FirstOrDefault();
    }

    private void AssignRedactor(string? preferredPlayerId = null)
    {
        var connected = _players.Values.Where(p => p.IsConnected).OrderByDescending(p => p.IsAdmin).ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList();
        if (connected.Count == 0) { _redactorPlayerId = null; return; }

        var redactor = !string.IsNullOrEmpty(preferredPlayerId)
            ? connected.FirstOrDefault(p => p.PlayerId == preferredPlayerId)
            : null;

        if (redactor is null)
        {
            _redactorIndex = _redactorIndex % connected.Count;
            redactor = connected[_redactorIndex];
        }

        _redactorPlayerId = redactor.PlayerId;

        foreach (var p in _players.Values)
            p.Role = p.PlayerId == _redactorPlayerId ? PlayerRole.Redactor : PlayerRole.Estimator;
    }

    /// <summary>
    /// Error relativo: |guess - correct| / max(|correct|, 1).
    /// Cuando correct = 0, usamos error absoluto puro (no hay denominador natural).
    /// Cuando correct es negativo, usamos |correct| como denominador.
    /// </summary>
    public static double ComputeRelativeError(double guess, double correct)
    {
        if (correct == 0.0)
        {
            // Sin denominador natural, conservamos distancia absoluta sin crear falsos empates.
            return Math.Min(Math.Abs(guess), 1e300);
        }

        return Math.Min(Math.Abs(guess - correct) / Math.Abs(correct), 1e300);
    }
}

/// <summary>
/// Tarea de la IA lanzada en segundo plano junto con la pregunta a la que responde.
/// Guardar la pregunta permite descartar resultados obsoletos si la ronda se reinicia.
/// </summary>
public sealed record PendingAnswer(string Question, Task<GeminiAnswerResult> Task);
