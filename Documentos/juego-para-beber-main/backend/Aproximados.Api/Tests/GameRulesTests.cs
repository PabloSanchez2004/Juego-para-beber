using Aproximados.Api.Models;

namespace Aproximados.Api.Tests;

public class GameRulesTests
{
    internal static Room CreateRoom(bool redactorCanGuess = false, int players = 3)
    {
        var room = new Room { Code = "RULE" };
        foreach (var i in Enumerable.Range(1, players))
            Assert.True(room.TryAddPlayer(new Player { Name = $"Jugador {i}", PlayerId = $"p{i}", ConnectionId = $"c{i}" }));
        Assert.True(room.TrySetRedactorCanGuess(redactorCanGuess));
        Assert.True(room.TryStartGame(3, false));
        Assert.Equal("p1", room.RedactorPlayerId);
        Assert.True(room.TrySubmitQuestion("p1", "¿Cuántos metros?"));
        return room;
    }

    [Fact]
    public void ClassicIsDefaultAndCannotBeChangedAfterStart()
    {
        var lobby = new Room();
        Assert.False(lobby.RedactorCanGuess);
        Assert.True(lobby.TrySetRedactorCanGuess(true));
        Assert.True(lobby.ToDto("").RedactorCanGuess);
        var started = CreateRoom();
        Assert.False(started.TrySetRedactorCanGuess(true));
        Assert.False(started.RedactorCanGuess);
        Assert.False(started.TrySubmitGuess("p1", 100).Ok);
        Assert.Equal(2, started.ToDto("p1").GuessesExpected);
    }

    [Fact]
    public void EveryoneModeWaitsForAuthorAndRanksTheirSecretAnswer()
    {
        var room = CreateRoom(true);
        Assert.Equal(3, room.ToDto("p1").GuessesExpected);
        Assert.False(room.TrySubmitGuess("p2", 150).AllSubmitted);
        Assert.False(room.TrySubmitGuess("p3", 200).AllSubmitted);
        Assert.False(room.ReadyToFinalize);
        Assert.True(room.TrySubmitGuess("p1", 100).AllSubmitted);
        Assert.Null(room.ToDto("p2").Players.Single(p => p.PlayerId == "p1").Guess);
        var result = room.FinalizeRound(100, "test", "")!;
        Assert.Equal(3, result.Ranking.Count);
        Assert.Equal("p1", result.Ranking[0].PlayerId);
        Assert.Equal(100, room.Players.Single(p => p.PlayerId == "p1").Score);
        Assert.Equal(67, room.Players.Single(p => p.PlayerId == "p2").Score);
        Assert.Equal(50, room.Players.Single(p => p.PlayerId == "p3").Score);
        Assert.True(room.TryDistributeDrinks("p1", "p2", 1));
        Assert.True(room.TryAdvanceRound());
        Assert.Equal("p1", room.RedactorPlayerId);
        Assert.True(room.TrySubmitQuestion("p1", "¿Cuántos segundos?"));
        Assert.Equal(3, room.ToDto("p1").GuessesExpected);
        Assert.True(room.TrySubmitGuess("p1", 60).Ok);
    }

    [Fact]
    public void DisconnectOfLastPendingEstimatorMakesRoundReadyWithoutAnotherGuess()
    {
        var room = CreateRoom();
        Assert.False(room.TrySubmitGuess("p2", 95).AllSubmitted);
        room.MarkDisconnected("c3");
        Assert.True(room.ReadyToFinalize);
        Assert.Equal(1, room.ToDto("p2").GuessesExpected);
        Assert.False(room.TrySubmitGuess("p3", 100).Ok);
    }

    [Fact]
    public void DisconnectedSubmittedPlayersStayInProgressAndRanking()
    {
        var room = CreateRoom(true);
        room.TrySubmitGuess("p2", 90);
        room.MarkDisconnected("c2");
        var dto = room.ToDto("p1");
        Assert.Equal(1, dto.GuessesSubmitted);
        Assert.Equal(3, dto.GuessesExpected);
        room.TrySubmitGuess("p1", 100);
        Assert.True(room.TrySubmitGuess("p3", 110).AllSubmitted);
        Assert.Equal(3, room.FinalizeRound(100, "test", "")!.Ranking.Count);
    }

    [Fact]
    public void DisconnectedHostAndWritingAuthorAreReplaced()
    {
        var room = CreateRoom();
        room.ResetGuessesForRetry();
        room.MarkDisconnected("c1");
        Assert.Equal("p2", room.AdminPlayerId);
        Assert.Equal("p2", room.RedactorPlayerId);
        Assert.False(room.TrySubmitQuestion("p1", "¿Otra pregunta?"));
        Assert.True(room.TrySubmitQuestion("p2", "¿Otra pregunta?"));
        room.TryReconnectPlayer("p1", "new-c1");
        Assert.Equal("p2", room.AdminPlayerId);
    }

    [Fact]
    public void LeavingAuthorAfterQuestionDoesNotChangeEstimatorEligibility()
    {
        var room = CreateRoom();
        Assert.True(room.RemovePlayer("p1"));
        Assert.True(room.TrySubmitGuess("p2", 100).Ok);
        Assert.True(room.TrySubmitGuess("p3", 200).AllSubmitted);
        room.ResetGuessesForRetry();
        Assert.Equal("p2", room.RedactorPlayerId);
        Assert.All(room.Players, p => Assert.Null(p.Guess));
    }

    [Fact]
    public void CannotJoinAnAlreadyStartedRoomEvenThroughDirectDomainCall()
    {
        Assert.Equal(JoinRejection.GameStarted, CreateRoom().AddPlayer(new Player { Name = "Intruso" }));
    }

    [Fact]
    public void EveryTiedWinnerGetsTheSameProportionalScoreAndNoLoser()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 90);
        room.TrySubmitGuess("p3", 90);
        var result = room.FinalizeRound(100, "test", "")!;
        Assert.All(result.Ranking, r => Assert.Equal(1, r.Rank));
        Assert.Equal(0, result.LoserPenalty);
        Assert.Equal("", result.LoserName);
        Assert.All(room.Players.Where(p => p.PlayerId != "p1"), p => Assert.Equal(94, p.Score));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void EasyQuestionPenalizesAuthorInBothModes(bool authorPlays)
    {
        var room = CreateRoom(authorPlays);
        room.TrySubmitGuess("p2", 99);
        room.TrySubmitGuess("p3", 101);
        if (authorPlays) room.TrySubmitGuess("p1", 100);
        var result = room.FinalizeRound(100, "test", "")!;
        Assert.Equal(1, result.RedactorPenalty);
        Assert.Contains("1%", result.RedactorPenaltyDescription);
        Assert.Equal(1, room.Players.Single(p => p.PlayerId == "p1").DrinksOwed);
        if (authorPlays) Assert.Equal(1, result.Ranking.Single(r => r.PlayerId == "p1").DrinksThisRound);
    }

    [Fact]
    public void MissingAnswersDoNotMakeAQuestionEasy()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 100);
        Assert.Equal(0, room.FinalizeRound(100, "test", "")!.RedactorPenalty);
    }

    [Fact]
    public void HugeErrorGetsTwoDrinks()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 95);
        room.TrySubmitGuess("p3", 1100);
        var result = room.FinalizeRound(100, "test", "")!;
        Assert.Equal(2, result.LoserPenalty);
        Assert.Equal(2, result.Ranking.Single(r => r.PlayerId == "p3").DrinksThisRound);
        Assert.Equal(2, room.Players.Single(p => p.PlayerId == "p3").DrinksOwed);
    }

    [Fact]
    public void DistributionCannotBeForgedRepeatedOrLoseUpdates()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 100);
        room.TrySubmitGuess("p3", 200);
        room.FinalizeRound(100, "test", "");
        Assert.False(room.TryDistributeDrinks("p3", "p1", 1));
        Assert.False(room.TryDistributeDrinks("p2", "p2", 1));
        Assert.False(room.TryDistributeDrinks("p2", "missing", 1));
        Assert.False(room.TryDistributeDrinks("p2", "p3", -1));
        Assert.False(room.TryDistributeDrinks("p2", "p3", int.MaxValue));
        Assert.True(room.HasPendingDistribution);
        var accepted = 0;
        Parallel.For(0, 20, _ => { if (room.TryDistributeDrinks("p2", "p3", 1)) Interlocked.Increment(ref accepted); });
        Assert.Equal(1, accepted);
        Assert.False(room.HasPendingDistribution);
        Assert.Equal(2, room.Players.Single(p => p.PlayerId == "p3").DrinksOwed);
        Assert.Equal(2, room.LastResult!.Ranking.Single(p => p.PlayerId == "p3").DrinksThisRound);
        Assert.Equal(1, room.LastResult.DrinksDistributedByWinner["p2"]);
        Assert.Single(room.LastResult.DrinkAssignments);
        Assert.True(room.TryAdvanceRound());
        Assert.False(room.TryDistributeDrinks("p2", "p3", 1));
    }

    [Fact]
    public void DisconnectedWinnerDoesNotBlockAdvanceAndLateSarcasmCannotOverwriteNextRound()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 100);
        room.TrySubmitGuess("p3", 200);
        room.FinalizeRound(100, "test", "");
        Assert.True(room.TrySetSarcasticComment(1, "Una órbita distinta."));
        room.MarkDisconnected("c2");
        Assert.False(room.HasPendingDistribution);
        Assert.True(room.TryAdvanceRound());
        Assert.Equal("p3", room.RedactorPlayerId);
        Assert.False(room.TrySetSarcasticComment(1, "tarde"));
    }

    [Fact]
    public void LastRoundStaysInResultsForTheFinalReveal()
    {
        var room = new Room { Code = "FIN1" };
        Assert.True(room.TryAddPlayer(new Player { Name = "Ana", PlayerId = "p1", ConnectionId = "c1" }));
        Assert.True(room.TryAddPlayer(new Player { Name = "Bob", PlayerId = "p2", ConnectionId = "c2" }));
        Assert.True(room.TryStartGame(1, false));
        Assert.True(room.TrySubmitQuestion("p1", "¿Cuántos?"));
        Assert.True(room.TrySubmitGuess("p2", 10).Ok);
        Assert.NotNull(room.FinalizeRound(10, "test", ""));
        Assert.True(room.TryDistributeDrinks("p2", "p1", 1));
        Assert.False(room.TryAdvanceRound());
        Assert.Equal(GamePhase.ShowingResults, room.Phase);
        Assert.Equal(1, room.RoundNumber);
        Assert.NotNull(room.LastResult);
    }

    [Fact]
    public void ZeroAnswerDoesNotCreateFalseTiesForLargeGuesses()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 2e6);
        room.TrySubmitGuess("p3", 5e6);
        var result = room.FinalizeRound(0, "test", "")!;
        Assert.Equal(1, result.Ranking.Single(p => p.PlayerId == "p2").Rank);
        Assert.Equal(2, result.Ranking.Single(p => p.PlayerId == "p3").Rank);
    }

    [Theory]
    [InlineData(0, 100)]
    [InlineData(0.4, 100)]
    [InlineData(0.5, 100)]
    [InlineData(1, 99)]
    [InlineData(12.4, 88)]
    [InlineData(12.5, 88)]
    [InlineData(50, 50)]
    [InlineData(99.4, 1)]
    [InlineData(99.5, 1)]
    [InlineData(100, 0)]
    [InlineData(1000, 0)]
    public void PercentageErrorMapsLinearlyToPoints(double errorPercent, int expected)
    {
        Assert.Equal(expected, Room.ComputePoints(errorPercent));
    }

    [Fact]
    public void EveryEstimatorAddsProportionalPointsToTheirTotal()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 100); // 0% error -> 100
        room.TrySubmitGuess("p3", 125); // 25% error -> 75

        var result = room.FinalizeRound(100, "test", "")!;

        Assert.Equal(100, result.Ranking.Single(r => r.PlayerId == "p2").PointsEarned);
        Assert.Equal(80, result.Ranking.Single(r => r.PlayerId == "p3").PointsEarned);
        Assert.Equal(100, room.Players.Single(p => p.PlayerId == "p2").Score);
        Assert.Equal(80, room.Players.Single(p => p.PlayerId == "p3").Score);
    }

    [Fact]
    public void DoubleOrNothingDoublesPointsInsideTenPercent()
    {
        var room = CreateRoom();
        Assert.True(room.TrySubmitGuess("p2", 110, true).Ok); // 10% -> 90 base
        room.TrySubmitGuess("p3", 150);

        var result = room.FinalizeRound(100, "test", "")!;
        var risky = result.Ranking.Single(r => r.PlayerId == "p2");

        Assert.Equal(95, risky.BasePoints);
        Assert.Equal(190, risky.PointsEarned);
        Assert.True(risky.UsedDoubleOrNothing);
        Assert.True(risky.DoubleOrNothingWon);
        Assert.Equal(190, room.Players.Single(p => p.PlayerId == "p2").Score);
        Assert.False(room.Players.Single(p => p.PlayerId == "p2").DoubleOrNothingAvailable);
    }

    [Fact]
    public void DoubleOrNothingAwardsZeroOutsideTenPercent()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 111, true);
        room.TrySubmitGuess("p3", 150);

        var risky = room.FinalizeRound(100, "test", "")!.Ranking.Single(r => r.PlayerId == "p2");

        Assert.Equal(94, risky.BasePoints);
        Assert.Equal(0, risky.PointsEarned);
        Assert.False(risky.DoubleOrNothingWon);
    }

    [Fact]
    public void DoubleOrNothingUseStaysSecretUntilResults()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 100, true);

        Assert.True(room.ToDto("p2").Players.Single(p => p.PlayerId == "p2").UsedDoubleOrNothingThisRound);
        Assert.False(room.ToDto("p3").Players.Single(p => p.PlayerId == "p2").UsedDoubleOrNothingThisRound);
        Assert.False(room.ToDto("p3").Players.Single(p => p.PlayerId == "p2").DoubleOrNothingAvailable);

        room.TrySubmitGuess("p3", 120);
        room.FinalizeRound(100, "test", "");
        Assert.True(room.ToDto("p3").Players.Single(p => p.PlayerId == "p2").UsedDoubleOrNothingThisRound);
    }

    [Fact]
    public void InvalidQuestionRefundsDoubleOrNothing()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 100, true);
        Assert.False(room.Players.Single(p => p.PlayerId == "p2").DoubleOrNothingAvailable);

        room.ResetGuessesForRetry();

        var player = room.Players.Single(p => p.PlayerId == "p2");
        Assert.True(player.DoubleOrNothingAvailable);
        Assert.False(player.UsedDoubleOrNothingThisRound);
        Assert.Null(player.Guess);
    }
}
