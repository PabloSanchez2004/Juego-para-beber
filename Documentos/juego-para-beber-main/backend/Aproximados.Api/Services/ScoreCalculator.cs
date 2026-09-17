namespace Aproximados.Api.Services;

/// <summary>
/// Entrada para el cálculo de puntuación de un jugador en una ronda.
/// </summary>
public sealed record PlayerScoreInput(
    string PlayerId,
    string PlayerName,
    double Guess,
    bool UsedDoubleOrNothing = false
);

/// <summary>
/// Resultado detallado del cálculo de puntuación para un jugador.
/// </summary>
public sealed record CalculatedPlayerScore
{
    public string PlayerId { get; init; } = string.Empty;
    public string PlayerName { get; init; } = string.Empty;
    public double Guess { get; init; }
    public double CorrectAnswer { get; init; }

    /// <summary>Distancia logarítmica/proporcional continua (>= 0).</summary>
    public double Distance { get; init; }

    /// <summary>Precisión absoluta en escala [0.0, 1.0].</summary>
    public double Accuracy { get; init; }

    /// <summary>Precisión absoluta en porcentaje [0.0, 100.0].</summary>
    public double AccuracyPercent => Accuracy * 100.0;

    /// <summary>Rendimiento relativo respecto al mejor jugador de la ronda [0.0, 1.0].</summary>
    public double RelativePerformance { get; init; }

    /// <summary>Porcentaje de error relativo para reglas auxiliares (tragos/comodines).</summary>
    public double RelativeErrorPercent { get; init; }

    /// <summary>Puntuación continua antes de redondeo [0.0, 100.0].</summary>
    public double RawScore { get; init; }

    /// <summary>Puntos base redondeados de la ronda [0, 100].</summary>
    public int BasePoints { get; init; }

    /// <summary>Puntos finales ganados tras aplicar comodines como Doble o nada.</summary>
    public int PointsEarned { get; init; }

    /// <summary>Posición en el ranking de la ronda (1 = mejor).</summary>
    public int Rank { get; init; }

    public bool UsedDoubleOrNothing { get; init; }
    public bool DoubleOrNothingWon { get; init; }
}

/// <summary>
/// Sistema continuo de cálculo de puntuaciones para Aproximados.
/// Combina precisión absoluta (distancia multiplicativa/logarítmica) y
/// rendimiento relativo respecto a la mejor estimación de la ronda.
/// </summary>
public static class ScoreCalculator
{
    public const double DefaultAbsoluteAccuracyWeight = 0.60;
    public const double DefaultRelativePerformanceWeight = 0.40;
    public const int MaxRoundScore = 100;
    public const int MinRoundScore = 0;
    public const double ScaleFactor = 0.01;
    public const double MinScale = 1.0;
    public const double DoubleOrNothingMaxErrorPercent = 10.0;

    /// <summary>
    /// Calcula la distancia multiplicativa/logarítmica entre la estimación y la respuesta correcta.
    /// Para valores del mismo signo: abs(ln((|guess| + scale) / (|correct| + scale))).
    /// Para signos opuestos o transiciones a través del cero, conecta suavemente la distancia vía origen.
    /// </summary>
    public static double ComputeDistance(double guess, double correctValue)
    {
        if (!double.IsFinite(guess) || !double.IsFinite(correctValue))
            return double.PositiveInfinity;

        if (guess == correctValue)
            return 0.0;

        double scale = Math.Max(MinScale, Math.Abs(correctValue) * ScaleFactor);

        double gAbs = Math.Abs(guess);
        double cAbs = Math.Abs(correctValue);

        // Si ambos tienen el mismo signo (ambos >= 0 o ambos <= 0)
        if ((guess >= 0.0 && correctValue >= 0.0) || (guess <= 0.0 && correctValue <= 0.0))
        {
            return Math.Abs(Math.Log((gAbs + scale) / (cAbs + scale)));
        }

        // Si tienen signos opuestos (p. ej. uno positivo y otro negativo),
        // realizamos una transición continua y suave a través de 0:
        double gDistFromZero = Math.Log((gAbs + scale) / scale);
        double cDistFromZero = Math.Log((cAbs + scale) / scale);
        return gDistFromZero + cDistFromZero;
    }

    /// <summary>
    /// Convierte la distancia en precisión absoluta acotada en [0.0, 1.0] usando exp(-distancia).
    /// </summary>
    public static double ComputeAccuracy(double distance)
    {
        if (!double.IsFinite(distance) || distance < 0.0)
            return 0.0;

        if (distance == 0.0)
            return 1.0;

        double accuracy = Math.Exp(-distance);
        if (!double.IsFinite(accuracy))
            return 0.0;

        return Math.Clamp(accuracy, 0.0, 1.0);
    }

    /// <summary>
    /// Calcula la precisión absoluta directa para una estimación y respuesta correcta.
    /// </summary>
    public static double ComputeAccuracy(double guess, double correctValue)
    {
        double distance = ComputeDistance(guess, correctValue);
        return ComputeAccuracy(distance);
    }

    /// <summary>
    /// Error relativo porcentual tradicional: |guess - correct| / max(|correct|, 1).
    /// Utilizado para penalizaciones de tragos y umbral del comodín Doble o nada.
    /// </summary>
    public static double ComputeRelativeError(double guess, double correct)
    {
        if (!double.IsFinite(guess) || !double.IsFinite(correct))
            return double.PositiveInfinity;

        if (correct == 0.0)
            return Math.Min(Math.Abs(guess), 1e300);

        return Math.Min(Math.Abs(guess - correct) / Math.Abs(correct), 1e300);
    }

    /// <summary>
    /// Calcula las puntuaciones, rankings y comodines de todos los jugadores de la ronda.
    /// </summary>
    public static IReadOnlyList<CalculatedPlayerScore> CalculateScores(
        double correctValue,
        IReadOnlyList<PlayerScoreInput> players,
        double absoluteWeight = DefaultAbsoluteAccuracyWeight,
        double relativeWeight = DefaultRelativePerformanceWeight,
        int maxRoundScore = MaxRoundScore)
    {
        if (players == null || players.Count == 0)
            return [];

        // 1. Calcular métricas individuales iniciales
        var metrics = new List<(PlayerScoreInput Input, double Distance, double Accuracy, double RelativeErrorPercent)>(players.Count);
        foreach (var p in players)
        {
            double dist = ComputeDistance(p.Guess, correctValue);
            double acc = ComputeAccuracy(dist);
            double relErrorPercent = ComputeRelativeError(p.Guess, correctValue) * 100.0;
            metrics.Add((p, dist, acc, relErrorPercent));
        }

        // 2. Determinar la mejor precisión de la ronda
        double bestAccuracy = metrics.Max(m => m.Accuracy);

        // 3. Ordenar por distancia ascendente (menor distancia / mayor precisión primero),
        // y desempate determinista por nombre.
        var sorted = metrics
            .OrderBy(m => m.Distance)
            .ThenBy(m => m.Input.PlayerName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // 4. Asignar rangos estándar de competición y calcular puntuaciones
        var results = new List<CalculatedPlayerScore>(sorted.Count);
        int rank = 1;

        for (int i = 0; i < sorted.Count; i++)
        {
            var current = sorted[i];

            if (i > 0 && Math.Abs(current.Distance - sorted[i - 1].Distance) > 1e-12)
            {
                rank = i + 1;
            }

            double relativePerformance = bestAccuracy > 0.0
                ? Math.Clamp(current.Accuracy / bestAccuracy, 0.0, 1.0)
                : 0.0;

            double rawScore = maxRoundScore * (
                (absoluteWeight * current.Accuracy) +
                (relativeWeight * relativePerformance)
            );

            int basePoints = Math.Clamp(
                (int)Math.Round(rawScore, MidpointRounding.AwayFromZero),
                MinRoundScore,
                maxRoundScore
            );

            bool jokerWon = current.Input.UsedDoubleOrNothing && (
                current.RelativeErrorPercent <= DoubleOrNothingMaxErrorPercent ||
                (correctValue == 0.0 && Math.Abs(current.Input.Guess) <= 0.10)
            );

            int pointsEarned = current.Input.UsedDoubleOrNothing
                ? (jokerWon ? checked(basePoints * 2) : 0)
                : basePoints;

            results.Add(new CalculatedPlayerScore
            {
                PlayerId = current.Input.PlayerId,
                PlayerName = current.Input.PlayerName,
                Guess = current.Input.Guess,
                CorrectAnswer = correctValue,
                Distance = current.Distance,
                Accuracy = current.Accuracy,
                RelativePerformance = relativePerformance,
                RelativeErrorPercent = current.RelativeErrorPercent,
                RawScore = rawScore,
                BasePoints = basePoints,
                PointsEarned = pointsEarned,
                Rank = rank,
                UsedDoubleOrNothing = current.Input.UsedDoubleOrNothing,
                DoubleOrNothingWon = jokerWon
            });
        }

        return results.AsReadOnly();
    }
}
