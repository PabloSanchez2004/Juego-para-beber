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
    // ── Constantes ─────────────────────────────────────────────────────────

    public const int MaxPlayers = 12;
    public const int MinPlayersToStart = 2;
    public const int DefaultMaxRounds = 10;

    /// <summary>Tiempo máximo de reconexión antes de expulsar al jugador.</summary>
    public static readonly TimeSpan ReconnectGracePeriod = TimeSpan.FromSeconds(30);

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
    private int _redactorIndex; // índice rotativo
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
    /// Intenta añadir un jugador. Devuelve false si la sala está llena,
    /// cerrada, o el nombre ya existe.
    /// </summary>
    public bool TryAddPlayer(Player player)
    {
        lock (_lock)
        {
            if (_phase == GamePhase.Closed) return false;
            if (_players.Count >= MaxPlayers) return false;
            if (_players.Values.Any(p => p.Name.Equals(player.Name, StringComparison.OrdinalIgnoreCase)))
                return false;

            _players[player.PlayerId] = player;
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
            _lastActivity = DateTimeOffset.UtcNow;
            return true;
        }
    }

    /// <summary>Marca al jugador como desconectado.</summary>
    public void MarkDisconnected(string connectionId)
    {
        lock (_lock)
        {
            var player = _players.Values.FirstOrDefault(p => p.ConnectionId == connectionId);
            if (player is null) return;

            player.IsConnected = false;
            player.DisconnectedAt = DateTimeOffset.UtcNow;
            _lastActivity = DateTimeOffset.UtcNow;
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

            MaxRounds = maxRounds;
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
            if (_redactorPlayerId != playerId) return false;
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
            if (_phase != GamePhase.CollectingGuesses) return (false, false);
            if (!_players.TryGetValue(playerId, out var player)) return (false, false);
            if (player.Role == PlayerRole.Redactor) return (false, false);
            if (player.Guess.HasValue) return (false, false); // ya envió

            player.Guess = guess;
            _lastActivity = DateTimeOffset.UtcNow;

            bool allSubmitted = _players.Values
                .Where(p => p.IsConnected && p.Role == PlayerRole.Estimator)
                .All(p => p.Guess.HasValue);

            return (true, allSubmitted);
        }
    }

    /// <summary>
    /// Calcula el ranking y aplica castigos. Avanza a ShowingResults.
    /// Devuelve null si la fase no es CollectingGuesses.
    /// </summary>
    public RoundResult? FinalizeRound(double correctAnswer, string answerSource, string sarcasticComment)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.CollectingGuesses) return null;

            var estimators = _players.Values
                .Where(p => p.Role == PlayerRole.Estimator && p.Guess.HasValue)
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
                .ThenBy(x => x.Player.Name) // desempate determinista por nombre
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

            // Ganador = rango 1 (puede haber empate → varios ganadores)
            var winners = results.Where(r => r.Rank == 1).ToList();
            var losers = results.Where(r => r.Rank == results.Max(x => x.Rank)).ToList();

            // Tragos: ganador reparte 3 tragos entre los demás; perdedor recibe chupito (2)
            const int winnerDrinks = 3;
            const int loserPenalty = 2;

            // Aplicar tragos a los jugadores.
            // Bucle por índice: reasignamos results[i] dentro del bucle y un foreach
            // lanzaría InvalidOperationException (colección modificada).
            for (int i = 0; i < results.Count; i++)
            {
                var r = results[i];
                var player = _players[r.PlayerId];
                bool isWinner = winners.Any(w => w.PlayerId == r.PlayerId);
                bool isLoser = losers.Any(l => l.PlayerId == r.PlayerId) && !isWinner;

                int drinks = 0;
                string penalty = string.Empty;

                if (isLoser)
                {
                    drinks = loserPenalty;
                    penalty = IsAlcoholFreeRoom
                        ? "🥤 Chupito de agua con sal. Que te aproveche, campeón."
                        : "🥃 Chupito al pozo. Sin excusas.";
                }
                else if (!isWinner)
                {
                    // Los del medio reciben 1 trago del ganador
                    drinks = 1;
                    penalty = IsAlcoholFreeRoom
                        ? "🧃 Un sorbo de lo que tengas. Eso es todo."
                        : "🍺 Un trago. Cortesía del ganador.";
                }

                player.DrinksOwed += drinks;
                player.Score += Math.Max(0, 100 - (int)Math.Round(ranked.First(x => x.Player.PlayerId == r.PlayerId).Error * 100));

                // Actualizar resultado con drinks
                results[i] = r with { DrinksThisRound = drinks, PenaltyDescription = penalty };
            }

            // Ganadores reparten tragos (ya contabilizados arriba en los demás)
            foreach (var w in winners)
            {
                var player = _players[w.PlayerId];
                // El ganador no bebe, pero sí acumula puntos extra
                player.Score += 10;
            }

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
                LoserPenalty = loserPenalty
            };

            _lastResult = roundResult;
            _pendingAnswer = null;
            _phase = GamePhase.ShowingResults;
            _lastActivity = DateTimeOffset.UtcNow;
            return roundResult;
        }
    }

    /// <summary>
    /// Avanza a la siguiente ronda o cierra el juego si se alcanzó el máximo.
    /// Devuelve true si hay más rondas, false si el juego terminó.
    /// </summary>
    public bool TryAdvanceRound()
    {
        lock (_lock)
        {
            if (_phase != GamePhase.ShowingResults) return false;

            if (_roundNumber >= MaxRounds)
            {
                _phase = GamePhase.Closed;
                return false;
            }

            _roundNumber++;
            _redactorIndex = (_redactorIndex + 1) % Math.Max(1, _players.Values.Count(p => p.IsConnected));
            AssignRedactor();

            foreach (var p in _players.Values)
                p.ResetForNewRound();

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

            int guessesSubmitted = _phase == GamePhase.CollectingGuesses
                ? _players.Values.Count(p => p.Role == PlayerRole.Estimator && p.Guess.HasValue)
                : 0;

            int guessesExpected = _phase == GamePhase.CollectingGuesses
                ? _players.Values.Count(p => p.IsConnected && p.Role == PlayerRole.Estimator)
                : 0;

            return new GameStateDto
            {
                RoomCode = Code,
                Phase = _phase,
                RoundNumber = _roundNumber,
                CurrentQuestion = _currentQuestion,
                RedactorPlayerId = _redactorPlayerId,
                Players = players.AsReadOnly(),
                LastResult = _lastResult,
                MaxRounds = MaxRounds,
                IsAlcoholFreeRoom = IsAlcoholFreeRoom,
                GuessesSubmitted = guessesSubmitted,
                GuessesExpected = guessesExpected
            };
        }
    }

    // ── Helpers privados ───────────────────────────────────────────────────

    private void AssignRedactor()
    {
        var connected = _players.Values.Where(p => p.IsConnected).ToList();
        if (connected.Count == 0) return;

        _redactorIndex = _redactorIndex % connected.Count;
        var redactor = connected[_redactorIndex];
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
            // Respuesta correcta es cero: error = |guess|, capped a 1 para normalizar
            return Math.Min(Math.Abs(guess), 1_000_000);
        }

        return Math.Abs(guess - correct) / Math.Abs(correct);
    }
}

/// <summary>
/// Tarea de la IA lanzada en segundo plano junto con la pregunta a la que responde.
/// Guardar la pregunta permite descartar resultados obsoletos si la ronda se reinicia.
/// </summary>
public sealed record PendingAnswer(string Question, Task<GeminiAnswerResult> Task);
