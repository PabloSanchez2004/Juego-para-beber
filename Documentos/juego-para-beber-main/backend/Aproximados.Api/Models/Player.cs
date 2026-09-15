namespace Aproximados.Api.Models;

/// <summary>
/// Representa a un jugador dentro de una sala.
/// El estado mutable (Guess, Score) se modifica siempre bajo el lock de Room.
/// </summary>
public sealed class Player
{
    /// <summary>Private recovery secret, excluded from every public DTO.</summary>
    public string ReconnectToken { get; } = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));

    public bool HasReconnectToken(string? token) => token is not null &&
        System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(ReconnectToken),
            System.Text.Encoding.UTF8.GetBytes(token));

    // ── Identidad ──────────────────────────────────────────────────────────

    /// <summary>Nombre visible elegido por el jugador.</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>
    /// ConnectionId de SignalR actual. Puede cambiar en reconexión.
    /// Actualizar siempre bajo el lock de Room.
    /// </summary>
    public string ConnectionId { get; set; } = string.Empty;

    /// <summary>
    /// Id estable generado al unirse por primera vez.
    /// Se usa como clave de reconexión para evitar duplicados/suplantación.
    /// </summary>
    public string PlayerId { get; init; } = Guid.NewGuid().ToString("N");

    /// <summary>
    /// Anfitrión de la sala: el jugador que la creó. Solo él puede iniciar la
    /// partida y expulsar a otros. Si abandona, <see cref="Room"/> promociona al
    /// siguiente para que la sala no quede huérfana.
    /// </summary>
    public bool IsAdmin { get; set; }

    // ── Estado de ronda ────────────────────────────────────────────────────

    /// <summary>Estimación enviada en la ronda actual. Null = no enviada aún.</summary>
    public double? Guess { get; set; }

    /// <summary>Rol asignado en la ronda actual.</summary>
    public PlayerRole Role { get; set; } = PlayerRole.Estimator;

    /// <summary>Puntuación acumulada (menor error relativo = mejor).</summary>
    public int Score { get; set; }

    /// <summary>Tragos acumulados que debe beber.</summary>
    public int DrinksOwed { get; set; }

    /// <summary>Indica si el jugador está conectado actualmente.</summary>
    public bool IsConnected { get; set; } = true;

    /// <summary>
    /// Inverso de <see cref="IsConnected"/>. En OnDisconnectedAsync se pone a true
    /// sin expulsar al jugador: el asiento se reserva hasta que expire el grace period
    /// o hasta que RejoinRoom actualice el ConnectionId.
    /// </summary>
    public bool IsDisconnected
    {
        get => !IsConnected;
        set => IsConnected = !value;
    }

    /// <summary>Momento de la última desconexión (para timeout de reconexión).</summary>
    public DateTimeOffset? DisconnectedAt { get; set; }

    // ── Modo sin alcohol ───────────────────────────────────────────────────

    /// <summary>Si true, los "tragos" se convierten en retos/penitencias sin alcohol.</summary>
    public bool AlcoholFree { get; set; }

    // ── Helpers ────────────────────────────────────────────────────────────

    /// <summary>Limpia el estado de estimación para la siguiente ronda.</summary>
    public void ResetForNewRound()
    {
        Guess = null;
        Role = PlayerRole.Estimator;
    }

    /// <summary>
    /// Proyección pública segura: nunca expone la estimación de otros jugadores
    /// mientras la fase es CollectingGuesses.
    /// </summary>
    public PlayerPublicDto ToPublicDto(GamePhase phase, string requestingPlayerId)
    {
        bool revealGuess = phase == GamePhase.ShowingResults || PlayerId == requestingPlayerId;
        return new PlayerPublicDto(
            PlayerId,
            Name,
            Role,
            Score,
            DrinksOwed,
            IsConnected,
            AlcoholFree,
            revealGuess ? Guess : null,
            IsAdmin
        );
    }
}

/// <summary>DTO seguro para enviar al cliente.</summary>
public sealed record PlayerPublicDto(
    string PlayerId,
    string Name,
    PlayerRole Role,
    int Score,
    int DrinksOwed,
    bool IsConnected,
    bool AlcoholFree,
    double? Guess,
    bool IsAdmin
);
