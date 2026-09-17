using Aproximados.Api.Models;
using System.Text.Json;

public class SecurityTests
{
    [Fact]
    public void RecoveryRequiresPrivateTokenAndDtoDoesNotExposeIt()
    {
        var player = new Player { Name = "Ana" };
        Assert.False(player.HasReconnectToken(null));
        Assert.False(player.HasReconnectToken(player.PlayerId));
        Assert.False(player.HasReconnectToken(new Player().ReconnectToken));
        Assert.True(player.HasReconnectToken(player.ReconnectToken));
        Assert.DoesNotContain(player.ReconnectToken, JsonSerializer.Serialize(player.ToPublicDto(GamePhase.Lobby, player.PlayerId)));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(1e16)]
    public void InvalidGuessesAreRejected(double guess)
    {
        var room = StartedRoom();
        Assert.False(room.TrySubmitGuess(Estimator(room).PlayerId, guess).Ok);
    }

    [Fact]
    public void HugeErrorCannotOverflowScoreOrJson()
    {
        var room = StartedRoom();
        var player = Estimator(room);
        room.TrySubmitGuess(player.PlayerId, 1e15);
        var result = room.FinalizeRound(1e-300, "test", "");
        Assert.NotNull(result);
        Assert.Equal(40, player.Score);
        Assert.True(double.IsFinite(result.Ranking[0].RelativeErrorPercent));
        Assert.NotEmpty(JsonSerializer.Serialize(result));
    }

    private static Player Estimator(Room room) => room.Players.Single(p => p.PlayerId != room.RedactorPlayerId);
    private static Room StartedRoom()
    {
        var room = new Room { Code = "TEST" };
        room.TryAddPlayer(new Player { Name = "Ana", ConnectionId = "a" });
        room.TryAddPlayer(new Player { Name = "Bob", ConnectionId = "b" });
        room.TryStartGame(3, false);
        room.TrySubmitQuestion(room.RedactorPlayerId!, "Cuánto mide?");
        return room;
    }
}
