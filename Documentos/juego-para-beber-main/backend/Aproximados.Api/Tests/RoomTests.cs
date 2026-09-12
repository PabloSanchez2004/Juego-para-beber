// Tests unitarios para Room, ranking, empates, cero, fases y privacidad.
// Framework: xUnit (añadir referencia en .csproj de tests si se separa en proyecto aparte).
// Estos tests se pueden ejecutar con: dotnet test
//
// Para ejecutarlos en un proyecto separado, crea Aproximados.Tests.csproj con:
//   <PackageReference Include="xunit" Version="2.9.*" />
//   <PackageReference Include="xunit.runner.visualstudio" Version="2.8.*" />
//   <ProjectReference Include="../Aproximados.Api/Aproximados.Api.csproj" />

using Aproximados.Api.Models;

namespace Aproximados.Api.Tests;

public class RoomRelativeErrorTests
{
    [Theory]
    [InlineData(100, 100, 0.0)]          // exacto
    [InlineData(150, 100, 0.5)]          // 50% error
    [InlineData(50, 100, 0.5)]           // 50% error (por debajo)
    [InlineData(0, 100, 1.0)]            // 100% error
    [InlineData(-100, 100, 2.0)]         // 200% error
    [InlineData(0, -50, 1.0)]            // respuesta negativa, guess 0
    [InlineData(-50, -50, 0.0)]          // respuesta negativa, exacto
    [InlineData(-25, -50, 0.5)]          // respuesta negativa, 50% error
    public void ComputeRelativeError_StandardCases(double guess, double correct, double expected)
    {
        var result = Room.ComputeRelativeError(guess, correct);
        Assert.Equal(expected, result, precision: 10);
    }

    [Theory]
    [InlineData(0, 0)]      // guess=0, correct=0 → error=0 (exacto)
    [InlineData(5, 0)]      // guess=5, correct=0 → error=5 (absoluto)
    [InlineData(-3, 0)]     // guess=-3, correct=0 → error=3
    public void ComputeRelativeError_CorrectAnswerIsZero(double guess, double expectedError)
    {
        var result = Room.ComputeRelativeError(guess, 0);
        Assert.Equal(expectedError, result, precision: 10);
    }
}

public class RoomRankingTests
{
    private static Room CreateRoomWithPlayers(params (string name, double guess)[] players)
    {
        var room = new Room { Code = "TEST" };
        foreach (var (name, _) in players)
        {
            room.TryAddPlayer(new Player
            {
                Name = name,
                ConnectionId = Guid.NewGuid().ToString(),
                PlayerId = Guid.NewGuid().ToString("N")
            });
        }

        // Iniciar juego
        room.TryStartGame(5, false);

        // Asignar estimaciones directamente (el Redactor no estima)
        var estimators = room.Players.Where(p => p.Role == PlayerRole.Estimator).ToList();
        int i = 0;
        foreach (var p in estimators)
        {
            if (i < players.Length)
            {
                // Buscar el guess por nombre
                var match = players.FirstOrDefault(x => x.name == p.Name);
                if (match != default)
                    room.TrySubmitGuess(p.PlayerId, match.guess);
            }
            i++;
        }

        return room;
    }

    [Fact]
    public void FinalizeRound_SingleWinner_CorrectRanking()
    {
        // Arrange: 3 jugadores, respuesta correcta = 100
        // Ana: guess=100 (0% error) → rank 1
        // Bob: guess=120 (20% error) → rank 2
        // Carlos: guess=150 (50% error) → rank 3
        var room = new Room { Code = "RANK" };
        var players = new[]
        {
            new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" },
            new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" },
            new Player { Name = "Carlos", ConnectionId = "c3", PlayerId = "p3" }
        };

        foreach (var p in players) room.TryAddPlayer(p);
        room.TryStartGame(5, false);

        // Forzar estimaciones (el Redactor no puede estimar)
        var estimators = room.Players.Where(p => p.Role == PlayerRole.Estimator).ToList();
        var guesses = new Dictionary<string, double>
        {
            ["Ana"] = 100, ["Bob"] = 120, ["Carlos"] = 150
        };

        foreach (var p in estimators)
        {
            if (guesses.TryGetValue(p.Name, out var g))
                room.TrySubmitGuess(p.PlayerId, g);
        }

        // Act
        var result = room.FinalizeRound(100, "test-source", "comentario");

        // Assert
        Assert.NotNull(result);
        var ranking = result.Ranking.OrderBy(r => r.Rank).ToList();

        // El jugador con guess=100 debe ser rank 1
        var winner = ranking.First();
        Assert.Equal(1, winner.Rank);
        Assert.Equal(0.0, winner.RelativeErrorPercent, precision: 5);
    }

    [Fact]
    public void FinalizeRound_TieBreak_DeterministicByName()
    {
        // Dos jugadores con el mismo error → mismo rango, desempate por nombre
        var room = new Room { Code = "TIE1" };
        var p1 = new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" };
        var p2 = new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" };
        var p3 = new Player { Name = "Carlos", ConnectionId = "c3", PlayerId = "p3" };

        room.TryAddPlayer(p1);
        room.TryAddPlayer(p2);
        room.TryAddPlayer(p3);
        room.TryStartGame(5, false);

        var estimators = room.Players.Where(p => p.Role == PlayerRole.Estimator).ToList();
        // Todos con el mismo error del 10%
        foreach (var p in estimators)
            room.TrySubmitGuess(p.PlayerId, 110); // 10% error sobre 100

        var result = room.FinalizeRound(100, "src", "comment");
        Assert.NotNull(result);

        // Todos deben tener el mismo rango (empate)
        var ranks = result.Ranking.Select(r => r.Rank).Distinct().ToList();
        Assert.Single(ranks); // todos en el mismo rango
    }

    [Fact]
    public void FinalizeRound_CorrectAnswerZero_UsesAbsoluteError()
    {
        var room = new Room { Code = "ZERO" };
        var p1 = new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" };
        var p2 = new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" };
        var p3 = new Player { Name = "Carlos", ConnectionId = "c3", PlayerId = "p3" };

        room.TryAddPlayer(p1);
        room.TryAddPlayer(p2);
        room.TryAddPlayer(p3);
        room.TryStartGame(5, false);

        var estimators = room.Players.Where(p => p.Role == PlayerRole.Estimator).ToList();
        var guesses = new[] { 0.0, 5.0 }; // uno exacto, otro con error 5
        int i = 0;
        foreach (var p in estimators)
        {
            if (i < guesses.Length)
                room.TrySubmitGuess(p.PlayerId, guesses[i++]);
        }

        var result = room.FinalizeRound(0, "src", "comment");
        Assert.NotNull(result);

        var winner = result.Ranking.OrderBy(r => r.Rank).First();
        Assert.Equal(0.0, winner.RelativeErrorPercent, precision: 5);
    }

    [Fact]
    public void FinalizeRound_NegativeCorrectAnswer_CorrectError()
    {
        var room = new Room { Code = "NEG1" };
        var p1 = new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" };
        var p2 = new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" };
        var p3 = new Player { Name = "Carlos", ConnectionId = "c3", PlayerId = "p3" };

        room.TryAddPlayer(p1);
        room.TryAddPlayer(p2);
        room.TryAddPlayer(p3);
        room.TryStartGame(5, false);

        var estimators = room.Players.Where(p => p.Role == PlayerRole.Estimator).ToList();
        var guesses = new[] { -50.0, -25.0 }; // exacto y 50% error
        int i = 0;
        foreach (var p in estimators)
        {
            if (i < guesses.Length)
                room.TrySubmitGuess(p.PlayerId, guesses[i++]);
        }

        var result = room.FinalizeRound(-50, "src", "comment");
        Assert.NotNull(result);

        var winner = result.Ranking.OrderBy(r => r.Rank).First();
        Assert.Equal(0.0, winner.RelativeErrorPercent, precision: 5);
    }
}

public class RoomPhaseTests
{
    [Fact]
    public void TrySubmitQuestion_WrongPhase_ReturnsFalse()
    {
        var room = new Room { Code = "PH01" };
        var p1 = new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" };
        room.TryAddPlayer(p1);

        // En Lobby, no se puede enviar pregunta
        Assert.False(room.TrySubmitQuestion("p1", "¿Cuántos km tiene la Tierra?"));
    }

    [Fact]
    public void TrySubmitGuess_WrongPhase_ReturnsFalse()
    {
        var room = new Room { Code = "PH02" };
        var p1 = new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" };
        var p2 = new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" };
        room.TryAddPlayer(p1);
        room.TryAddPlayer(p2);

        // En Lobby, no se puede enviar estimación
        var (ok, _) = room.TrySubmitGuess("p1", 42);
        Assert.False(ok);
    }

    [Fact]
    public void TryStartGame_RequiresMinPlayers()
    {
        var room = new Room { Code = "PH03" };
        var p1 = new Player { Name = "Solo", ConnectionId = "c1", PlayerId = "p1" };
        room.TryAddPlayer(p1);

        Assert.False(room.TryStartGame(5, false));
    }

    [Fact]
    public void TrySetMaxRounds_InLobby_IsHonoredByStartGame()
    {
        var room = new Room { Code = "RND3" };
        room.TryAddPlayer(new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" });
        room.TryAddPlayer(new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" });

        Assert.True(room.TrySetMaxRounds(3));
        Assert.Equal(3, room.ToDto("p1").MaxRounds);
        Assert.True(room.TryStartGame(room.MaxRounds, false));
        Assert.Equal(3, room.MaxRounds);
    }

    [Fact]
    public void TryStartGame_WithEnoughPlayers_Succeeds()
    {
        var room = new Room { Code = "PH04" };
        room.TryAddPlayer(new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" });
        room.TryAddPlayer(new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" });

        Assert.True(room.TryStartGame(5, false));
        Assert.Equal(GamePhase.WritingQuestion, room.Phase);
    }

    [Fact]
    public void RedactorCannotSubmitGuess()
    {
        var room = new Room { Code = "PH05" };
        room.TryAddPlayer(new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" });
        room.TryAddPlayer(new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" });
        room.TryStartGame(5, false);

        var redactor = room.Players.First(p => p.Role == PlayerRole.Redactor);
        room.TrySubmitQuestion(redactor.PlayerId, "¿Cuántos km tiene la Tierra?");

        var (ok, _) = room.TrySubmitGuess(redactor.PlayerId, 12742);
        Assert.False(ok);
    }

    [Fact]
    public void PlayerCannotSubmitGuessTwice()
    {
        var room = new Room { Code = "PH06" };
        room.TryAddPlayer(new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" });
        room.TryAddPlayer(new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" });
        room.TryStartGame(5, false);

        var redactor = room.Players.First(p => p.Role == PlayerRole.Redactor);
        var estimator = room.Players.First(p => p.Role == PlayerRole.Estimator);

        room.TrySubmitQuestion(redactor.PlayerId, "¿Cuántos km tiene la Tierra?");

        var (ok1, _) = room.TrySubmitGuess(estimator.PlayerId, 12742);
        var (ok2, _) = room.TrySubmitGuess(estimator.PlayerId, 13000);

        Assert.True(ok1);
        Assert.False(ok2); // segunda vez debe fallar
    }
}

public class RoomPrivacyTests
{
    [Fact]
    public void ToDto_DuringCollectingGuesses_HidesOtherPlayersGuesses()
    {
        var room = new Room { Code = "PRIV" };
        var p1 = new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" };
        var p2 = new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" };
        var p3 = new Player { Name = "Carlos", ConnectionId = "c3", PlayerId = "p3" };

        room.TryAddPlayer(p1);
        room.TryAddPlayer(p2);
        room.TryAddPlayer(p3);
        room.TryStartGame(5, false);

        var redactor = room.Players.First(p => p.Role == PlayerRole.Redactor);
        room.TrySubmitQuestion(redactor.PlayerId, "¿Cuántos km tiene la Tierra?");

        var estimators = room.Players.Where(p => p.Role == PlayerRole.Estimator).ToList();
        room.TrySubmitGuess(estimators[0].PlayerId, 12742);

        // Ana solicita el estado: solo debe ver su propia estimación
        var dtoForEstimator0 = room.ToDto(estimators[0].PlayerId);
        var dtoForEstimator1 = estimators.Count > 1 ? room.ToDto(estimators[1].PlayerId) : null;

        // El jugador que envió debe ver su propia estimación
        var selfInDto = dtoForEstimator0.Players.First(p => p.PlayerId == estimators[0].PlayerId);
        Assert.NotNull(selfInDto.Guess);

        // El otro jugador no debe ver la estimación del primero
        if (dtoForEstimator1 is not null)
        {
            var otherInDto = dtoForEstimator1.Players.First(p => p.PlayerId == estimators[0].PlayerId);
            Assert.Null(otherInDto.Guess);
        }
    }

    [Fact]
    public void ToDto_DuringShowingResults_RevealsAllGuesses()
    {
        var room = new Room { Code = "REVL" };
        var p1 = new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" };
        var p2 = new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" };
        var p3 = new Player { Name = "Carlos", ConnectionId = "c3", PlayerId = "p3" };

        room.TryAddPlayer(p1);
        room.TryAddPlayer(p2);
        room.TryAddPlayer(p3);
        room.TryStartGame(5, false);

        var redactor = room.Players.First(p => p.Role == PlayerRole.Redactor);
        room.TrySubmitQuestion(redactor.PlayerId, "¿Cuántos km tiene la Tierra?");

        var estimators = room.Players.Where(p => p.Role == PlayerRole.Estimator).ToList();
        foreach (var e in estimators)
            room.TrySubmitGuess(e.PlayerId, 12742);

        room.FinalizeRound(12742, "wikipedia", "¡Exacto!");

        // En ShowingResults, todos ven todas las estimaciones
        var dto = room.ToDto(estimators[0].PlayerId);
        var estimatorDtos = dto.Players.Where(p => p.PlayerId != redactor.PlayerId).ToList();

        foreach (var ep in estimatorDtos)
            Assert.NotNull(ep.Guess);
    }
}

/// <summary>
/// Regresión del bug «espera N respuestas en vez de N-1»: desde la ronda 2,
/// TryAdvanceRound reseteaba los roles DESPUÉS de asignar el Redactor, así que
/// el Redactor contaba como estimador y la ronda nunca cerraba.
/// </summary>
public class RoomTwoPlayerFlowTests
{
    private static Room CreateStartedTwoPlayerRoom()
    {
        var room = new Room { Code = "DUO1" };
        room.TryAddPlayer(new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" });
        room.TryAddPlayer(new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" });
        Assert.True(room.TryStartGame(3, false));
        return room;
    }

    private static Player EstimatorOf(Room room) =>
        room.Players.Single(p => p.PlayerId != room.RedactorPlayerId);

    [Fact]
    public void Round1_TwoPlayers_ExpectsExactlyOneGuess()
    {
        var room = CreateStartedTwoPlayerRoom();
        room.TrySubmitQuestion(room.RedactorPlayerId!, "¿Cuántos km tiene la Tierra?");

        var dto = room.ToDto("p1");
        Assert.Equal(1, dto.GuessesExpected);
        Assert.Equal(0, dto.GuessesSubmitted);

        var (ok, allSubmitted) = room.TrySubmitGuess(EstimatorOf(room).PlayerId, 12000);
        Assert.True(ok);
        Assert.True(allSubmitted); // 1 de 1 → cierra
    }

    [Fact]
    public void Round2_TwoPlayers_RedactorRotatesAndStillExpectsOneGuess()
    {
        var room = CreateStartedTwoPlayerRoom();
        var firstRedactor = room.RedactorPlayerId;

        room.TrySubmitQuestion(firstRedactor!, "¿Cuántos km tiene la Tierra?");
        room.TrySubmitGuess(EstimatorOf(room).PlayerId, 12000);
        Assert.NotNull(room.FinalizeRound(12742, "src", string.Empty));
        Assert.True(room.TryAdvanceRound());

        // El Redactor rota y su rol debe reflejarlo
        Assert.NotEqual(firstRedactor, room.RedactorPlayerId);
        var redactor = room.Players.Single(p => p.PlayerId == room.RedactorPlayerId);
        Assert.Equal(PlayerRole.Redactor, redactor.Role);
        Assert.Equal(PlayerRole.Estimator, EstimatorOf(room).Role);

        room.TrySubmitQuestion(room.RedactorPlayerId!, "¿Cuántos huesos tiene el cuerpo humano?");

        // Condición de cierre: recibidas == jugadores - 1
        Assert.Equal(room.Players.Count - 1, room.ToDto("p1").GuessesExpected);

        var (redactorOk, _) = room.TrySubmitGuess(room.RedactorPlayerId!, 200);
        Assert.False(redactorOk); // el Redactor sigue sin poder adivinar

        var (ok, allSubmitted) = room.TrySubmitGuess(EstimatorOf(room).PlayerId, 206);
        Assert.True(ok);
        Assert.True(allSubmitted);
    }

    [Fact]
    public void FinalizeRound_SingleEstimator_IsWinnerWithoutLoser()
    {
        var room = CreateStartedTwoPlayerRoom();
        room.TrySubmitQuestion(room.RedactorPlayerId!, "¿Cuántos km tiene la Tierra?");
        var estimator = EstimatorOf(room);
        room.TrySubmitGuess(estimator.PlayerId, 10000);

        var result = room.FinalizeRound(12742, "src", string.Empty);

        Assert.NotNull(result);
        Assert.Single(result.Ranking);
        Assert.Equal(estimator.Name, result.WinnerName);
        Assert.Equal(string.Empty, result.LoserName);
        Assert.Equal(0, result.Ranking[0].DrinksThisRound);
        Assert.Equal(1, result.DrinksToDistribute);
    }

    [Fact]
    public void FinalizeRound_ThreeEstimators_WinnerDistributesAndLoserDrinks()
    {
        var room = new Room { Code = "TRIO" };
        room.TryAddPlayer(new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" });
        room.TryAddPlayer(new Player { Name = "Bob", ConnectionId = "c2", PlayerId = "p2" });
        room.TryAddPlayer(new Player { Name = "Carlos", ConnectionId = "c3", PlayerId = "p3" });
        room.TryAddPlayer(new Player { Name = "Dani", ConnectionId = "c4", PlayerId = "p4" });
        room.TryStartGame(3, false);
        room.TrySubmitQuestion(room.RedactorPlayerId!, "¿Cuánto es?");

        var guesses = new Queue<double>([100, 130, 400]);
        foreach (var p in room.Players.Where(p => p.PlayerId != room.RedactorPlayerId).OrderBy(p => p.Name))
            room.TrySubmitGuess(p.PlayerId, guesses.Dequeue());

        var result = room.FinalizeRound(100, "src", string.Empty)!;
        var ranking = result.Ranking.OrderBy(r => r.Rank).ToList();

        Assert.Equal(1, ranking[0].Rank);
        Assert.Equal(0, ranking[0].DrinksThisRound);              // ganador reparte, no bebe
        Assert.Equal(0, ranking[1].DrinksThisRound);              // el del medio no bebe
        Assert.Equal(1, ranking[2].DrinksThisRound);              // perdedor bebe
        Assert.False(string.IsNullOrEmpty(ranking[2].PenaltyDescription));
        Assert.Equal(ranking[0].PlayerName, result.WinnerName);
        Assert.Equal(ranking[2].PlayerName, result.LoserName);
    }
}

public class RoomReconnectionTests
{
    [Fact]
    public void TryReconnectPlayer_ValidPlayerId_UpdatesConnectionId()
    {
        var room = new Room { Code = "RCON" };
        var player = new Player { Name = "Ana", ConnectionId = "old-conn", PlayerId = "p1" };
        room.TryAddPlayer(player);

        room.MarkDisconnected("old-conn");
        Assert.False(player.IsConnected);

        bool ok = room.TryReconnectPlayer("p1", "new-conn");
        Assert.True(ok);
        Assert.True(player.IsConnected);
        Assert.False(player.IsDisconnected);
        Assert.Equal("new-conn", player.ConnectionId);
    }

    [Fact]
    public void TryMarkDisconnected_AfterRejoin_DoesNotClobberNewConnection()
    {
        var room = new Room { Code = "RACE" };
        var player = new Player { Name = "Ana", ConnectionId = "old-conn", PlayerId = "p1" };
        room.TryAddPlayer(player);

        room.TryReconnectPlayer("p1", "new-conn");
        Assert.False(room.TryMarkDisconnected("p1", "old-conn"));
        Assert.True(player.IsConnected);
        Assert.Equal("new-conn", player.ConnectionId);
    }

    [Fact]
    public void TryReconnectPlayer_InvalidPlayerId_ReturnsFalse()
    {
        var room = new Room { Code = "RCON2" };
        bool ok = room.TryReconnectPlayer("nonexistent", "new-conn");
        Assert.False(ok);
    }

    [Fact]
    public void PurgeTimedOutPlayers_RemovesExpiredPlayers()
    {
        var room = new Room { Code = "PURG" };
        var player = new Player { Name = "Ana", ConnectionId = "c1", PlayerId = "p1" };
        room.TryAddPlayer(player);

        room.MarkDisconnected("c1");

        // Simular que el grace period expiró
        player.DisconnectedAt = DateTimeOffset.UtcNow - Room.ReconnectGracePeriod - TimeSpan.FromSeconds(1);

        var purged = room.PurgeTimedOutPlayers();
        Assert.Contains("p1", purged);
        Assert.DoesNotContain(room.Players, p => p.PlayerId == "p1");
    }
}
