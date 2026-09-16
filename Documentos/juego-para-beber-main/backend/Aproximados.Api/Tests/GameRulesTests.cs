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
        Assert.Equal(1, room.Players.Single(p => p.PlayerId == "p1").Score);
        Assert.All(room.Players.Where(p => p.PlayerId != "p1"), p => Assert.Equal(0, p.Score));
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
    public void EveryTiedWinnerGetsOnePointAndNoLoser()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 90);
        room.TrySubmitGuess("p3", 110);
        var result = room.FinalizeRound(100, "test", "")!;
        Assert.All(result.Ranking, r => Assert.Equal(1, r.Rank));
        Assert.Equal(0, result.LoserPenalty);
        Assert.Equal("", result.LoserName);
        Assert.All(room.Players.Where(p => p.PlayerId != "p1"), p => Assert.Equal(1, p.Score));
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
        Assert.False(room.TryAdvanceRound());
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
    public void ZeroAnswerDoesNotCreateFalseTiesForLargeGuesses()
    {
        var room = CreateRoom();
        room.TrySubmitGuess("p2", 2e6);
        room.TrySubmitGuess("p3", 5e6);
        var result = room.FinalizeRound(0, "test", "")!;
        Assert.Equal(1, result.Ranking.Single(p => p.PlayerId == "p2").Rank);
        Assert.Equal(2, result.Ranking.Single(p => p.PlayerId == "p3").Rank);
    }
}
