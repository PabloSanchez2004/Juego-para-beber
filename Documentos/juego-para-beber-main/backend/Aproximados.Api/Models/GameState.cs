namespace Aproximados.Api.Models;

/// <summary>
/// Estado inmutable de la ronda actual, generado al pasar a ShowingResults.
/// Contiene el ranking calculado y los castigos asignados.
/// </summary>
public sealed record RoundResult
{
    public int RoundNumber { get; init; }
    public string Question { get; init; } = string.Empty;
    public double CorrectAnswer { get; init; }
    public string AnswerSource { get; init; } = string.Empty;

    /// <summary>Ranking ordenado de menor a mayor error relativo.</summary>
    public IReadOnlyList<PlayerRoundResult> Ranking { get; init; } = [];

    /// <summary>Comentario sarcástico generado por IA para el perdedor.</summary>
    public string SarcasticComment { get; init; } = string.Empty;

    /// <summary>Nombre del ganador (reparte tragos).</summary>
    public string WinnerName { get; init; } = string.Empty;

    /// <summary>Nombre del perdedor (recibe castigo).</summary>
    public string LoserName { get; init; } = string.Empty;

    /// <summary>Tragos que el ganador reparte (distribuidos entre los demás).</summary>
    public int DrinksToDistribute { get; init; }

    /// <summary>Tragos/chupito que recibe el perdedor.</summary>
    public int LoserPenalty { get; init; }

    public int RedactorPenalty { get; init; }
    public string RedactorPenaltyDescription { get; init; } = string.Empty;

    /// <summary>Tragos ya asignados por cada ganador, sin exceder su presupuesto.</summary>
    public IReadOnlyDictionary<string, int> DrinksDistributedByWinner { get; init; } = new Dictionary<string, int>();
    public IReadOnlyList<DrinkAssignment> DrinkAssignments { get; init; } = [];
}

public sealed record DrinkAssignment(string FromPlayerId, string ToPlayerId, int Amount);

/// <summary>Resultado individual de un jugador en una ronda.</summary>
public sealed record PlayerRoundResult
{
    public string PlayerId { get; init; } = string.Empty;
    public string PlayerName { get; init; } = string.Empty;
    public double Guess { get; init; }
    public double CorrectAnswer { get; init; }

    /// <summary>Precisión absoluta normalizada [0.0, 1.0].</summary>
    public double Accuracy { get; init; }

    /// <summary>Precisión absoluta en porcentaje [0.0, 100.0].</summary>
    public double AccuracyPercent => Accuracy * 100.0;

    /// <summary>Rendimiento relativo respecto al mejor jugador de la ronda [0.0, 1.0].</summary>
    public double RelativePerformance { get; init; }

    /// <summary>
    /// Error relativo porcentual. Para respuesta correcta = 0, se usa error absoluto.
    /// Para respuesta negativa, se usa |guess - correct| / |correct|.
    /// </summary>
    public double RelativeErrorPercent { get; init; }

    /// <summary>Posición en el ranking (1 = mejor).</summary>
    public int Rank { get; init; }

    /// <summary>
    /// Puntos finales obtenidos esta ronda, después de aplicar el comodín.
    /// </summary>
    public int PointsEarned { get; init; }

    /// <summary>Puntos continuos ponderados antes de aplicar Doble o nada.</summary>
    public int BasePoints { get; init; }

    public bool UsedDoubleOrNothing { get; init; }
    public bool DoubleOrNothingWon { get; init; }

    /// <summary>Tragos recibidos esta ronda.</summary>
    public int DrinksThisRound { get; init; }

    /// <summary>Descripción del castigo (modo sin alcohol).</summary>
    public string PenaltyDescription { get; init; } = string.Empty;
}

/// <summary>
/// Snapshot del estado de la sala enviado a los clientes.
/// Nunca incluye estimaciones de otros jugadores durante CollectingGuesses.
/// </summary>
public sealed class GameStateDto
{
    public string RoomCode { get; init; } = string.Empty;
    public GamePhase Phase { get; init; }
    public int RoundNumber { get; init; }
    public string? CurrentQuestion { get; init; }
    public string? RedactorPlayerId { get; init; }

    /// <summary>Anfitrión de la sala: el único que puede empezar la partida y expulsar.</summary>
    public string? AdminPlayerId { get; init; }

    public IReadOnlyList<PlayerPublicDto> Players { get; init; } = [];
    public RoundResult? LastResult { get; init; }
    public int MaxRounds { get; init; }
    public bool IsAlcoholFreeRoom { get; init; }
    public bool RedactorCanGuess { get; init; }

    /// <summary>Cuántos jugadores han enviado estimación (sin revelar quiénes).</summary>
    public int GuessesSubmitted { get; init; }

    /// <summary>Total de estimadores esperados esta ronda.</summary>
    public int GuessesExpected { get; init; }
}
