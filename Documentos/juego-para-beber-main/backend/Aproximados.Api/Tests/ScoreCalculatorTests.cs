using Aproximados.Api.Services;

namespace Aproximados.Api.Tests;

public class ScoreCalculatorTests
{
    [Fact]
    public void ExactMatch_Awards100Points()
    {
        // 1. Exactitud: correct = 100, guess = 100 -> score = 100
        var players = new[]
        {
            new PlayerScoreInput("p1", "Ana", 100)
        };

        var results = ScoreCalculator.CalculateScores(100, players);

        Assert.Single(results);
        Assert.Equal(1.0, results[0].Accuracy, precision: 6);
        Assert.Equal(1.0, results[0].RelativePerformance, precision: 6);
        Assert.Equal(100, results[0].BasePoints);
        Assert.Equal(100, results[0].PointsEarned);
        Assert.Equal(1, results[0].Rank);
    }

    [Fact]
    public void MultiplicativeSymmetry_HalfAndDoubleHaveEquivalentAccuracy()
    {
        // 2. Simetría multiplicativa: correct = 100, guesses 50 y 200
        double accHalf = ScoreCalculator.ComputeAccuracy(50, 100);
        double accDouble = ScoreCalculator.ComputeAccuracy(200, 100);

        // Ambas deben estar en torno a 0.50 (dentro de un margen estrecho < 0.01)
        Assert.InRange(accHalf, 0.49, 0.52);
        Assert.InRange(accDouble, 0.49, 0.52);
        Assert.True(Math.Abs(accHalf - accDouble) < 0.01);
    }

    [Fact]
    public void ScaleInvariance_SmallAndLargeNumbersBehaveEquivalently()
    {
        // 3. Escala: correct = 100, guess = 50 frente a correct = 1.000.000.000, guess = 500.000.000
        double accSmall = ScoreCalculator.ComputeAccuracy(50, 100);
        double accLarge = ScoreCalculator.ComputeAccuracy(500_000_000, 1_000_000_000);

        Assert.Equal(accSmall, accLarge, precision: 4);
    }

    [Fact]
    public void ExtremelyDifficultQuestion_WinnerGetsPointsWithoutReaching100()
    {
        // 4. Pregunta extremadamente difícil: correct = 1.000.000
        // Jugadores en 50M, 100M, 500M
        var players = new[]
        {
            new PlayerScoreInput("p1", "A", 50_000_000),
            new PlayerScoreInput("p2", "B", 100_000_000),
            new PlayerScoreInput("p3", "C", 500_000_000)
        };

        var results = ScoreCalculator.CalculateScores(1_000_000, players);

        var winner = results.Single(r => r.PlayerId == "p1");
        var second = results.Single(r => r.PlayerId == "p2");
        var third = results.Single(r => r.PlayerId == "p3");

        // El ganador debe obtener algunos puntos por componente relativo (~40-42), pero NO cerca de 100
        Assert.InRange(winner.BasePoints, 35, 45);
        Assert.InRange(second.BasePoints, 18, 25);
        Assert.InRange(third.BasePoints, 1, 8);

        Assert.True(winner.BasePoints > second.BasePoints);
        Assert.True(second.BasePoints > third.BasePoints);
    }

    [Fact]
    public void ClearlyBetterWinner_ReceivesSignificantlyMorePoints()
    {
        // 5. Ganador claramente mejor: correct = 1.000, guesses 1.100, 2.000, 10.000
        var players = new[]
        {
            new PlayerScoreInput("p1", "A", 1_100),
            new PlayerScoreInput("p2", "B", 2_000),
            new PlayerScoreInput("p3", "C", 10_000)
        };

        var results = ScoreCalculator.CalculateScores(1_000, players);

        var first = results.Single(r => r.PlayerId == "p1");
        var second = results.Single(r => r.PlayerId == "p2");
        var third = results.Single(r => r.PlayerId == "p3");

        Assert.InRange(first.BasePoints, 90, 98);
        Assert.InRange(second.BasePoints, 48, 56);
        Assert.InRange(third.BasePoints, 5, 15);
    }

    [Fact]
    public void SimilarAnswers_ReceiveSimilarPoints()
    {
        // 6. Respuestas similares: correct = 1.000, guesses 1.050 y 1.060
        var players = new[]
        {
            new PlayerScoreInput("p1", "A", 1_050),
            new PlayerScoreInput("p2", "B", 1_060)
        };

        var results = ScoreCalculator.CalculateScores(1_000, players);

        var first = results.Single(r => r.PlayerId == "p1");
        var second = results.Single(r => r.PlayerId == "p2");

        Assert.True(Math.Abs(first.BasePoints - second.BasePoints) <= 2);
    }

    [Fact]
    public void Tie_EqualGuessesGetIdenticalScoresAndRank()
    {
        // 7. Empate: dos jugadores con la misma respuesta
        var players = new[]
        {
            new PlayerScoreInput("p1", "Ana", 80),
            new PlayerScoreInput("p2", "Bob", 80)
        };

        var results = ScoreCalculator.CalculateScores(100, players);

        Assert.Equal(results[0].BasePoints, results[1].BasePoints);
        Assert.Equal(results[0].Rank, results[1].Rank);
        Assert.Equal(1, results[0].Rank);
    }

    [Theory]
    [InlineData(100, 100)]
    [InlineData(100, 0)]
    [InlineData(0, 0)]
    [InlineData(0, 1000)]
    [InlineData(1e12, 1e12)]
    [InlineData(1e12, 1)]
    [InlineData(1, 1e12)]
    [InlineData(-50, -50)]
    [InlineData(-50, 50)]
    public void ScoreLimits_AlwaysBetween0And100(double correct, double guess)
    {
        // 8. Límites: siempre score >= 0 y score <= 100
        var players = new[]
        {
            new PlayerScoreInput("p1", "A", guess)
        };

        var results = ScoreCalculator.CalculateScores(correct, players);

        Assert.Single(results);
        Assert.InRange(results[0].BasePoints, 0, 100);
        Assert.InRange(results[0].PointsEarned, 0, 200); // 200 solo con doble o nada
    }

    [Theory]
    [InlineData(87.73, 88)]
    [InlineData(74.21, 74)]
    [InlineData(99.62, 100)]
    [InlineData(4.49, 4)]
    [InlineData(0.4, 0)]
    [InlineData(0.5, 1)]
    public void Rounding_RoundsConsistentlyAwayFromZero(double raw, int expected)
    {
        // 9. Redondeo
        int rounded = Math.Clamp((int)Math.Round(raw, MidpointRounding.AwayFromZero), 0, 100);
        Assert.Equal(expected, rounded);
    }

    [Fact]
    public void EdgeCase_CorrectZero_PlayerZero_Gets100()
    {
        var players = new[] { new PlayerScoreInput("p1", "A", 0) };
        var results = ScoreCalculator.CalculateScores(0, players);

        Assert.Equal(100, results[0].BasePoints);
    }

    [Fact]
    public void EdgeCase_NegativeAnswers_ExactNegativeGets100()
    {
        var players = new[] { new PlayerScoreInput("p1", "A", -50) };
        var results = ScoreCalculator.CalculateScores(-50, players);

        Assert.Equal(100, results[0].BasePoints);
    }

    [Fact]
    public void EdgeCase_SinglePlayer_ScoresProportionally()
    {
        var players = new[] { new PlayerScoreInput("p1", "Solo", 50) };
        var results = ScoreCalculator.CalculateScores(100, players);

        // accuracy ≈ 0.505, relativePerformance = 1.0 -> score = 100 * (0.60 * 0.505 + 0.40 * 1.0) ≈ 70
        Assert.InRange(results[0].BasePoints, 69, 71);
    }

    [Fact]
    public void EdgeCase_InvalidNumbers_HandledSafelyWithoutCrash()
    {
        var players = new[]
        {
            new PlayerScoreInput("p1", "Valid", 100),
            new PlayerScoreInput("p2", "Nan", double.NaN),
            new PlayerScoreInput("p3", "Inf", double.PositiveInfinity)
        };

        var results = ScoreCalculator.CalculateScores(100, players);

        Assert.Equal(3, results.Count);
        Assert.Equal(100, results.Single(r => r.PlayerId == "p1").BasePoints);
        Assert.Equal(0, results.Single(r => r.PlayerId == "p2").BasePoints);
        Assert.Equal(0, results.Single(r => r.PlayerId == "p3").BasePoints);
    }
}
