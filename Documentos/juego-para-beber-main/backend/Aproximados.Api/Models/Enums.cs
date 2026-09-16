namespace Aproximados.Api.Models;

/// <summary>
/// Fases del ciclo de vida de una sala/ronda.
/// </summary>
public enum GamePhase
{
    /// <summary>Sala creada, esperando jugadores.</summary>
    Lobby,

    /// <summary>El Redactor está escribiendo la pregunta.</summary>
    WritingQuestion,

    /// <summary>Los estimadores están enviando sus respuestas (ocultas entre sí).</summary>
    CollectingGuesses,

    /// <summary>Resultados visibles: ranking, tragos y comentario IA.</summary>
    ShowingResults,

    /// <summary>La sala ha expirado o fue cerrada.</summary>
    Closed
}

/// <summary>
/// Rol del jugador en la ronda actual.
/// </summary>
public enum PlayerRole
{
    /// <summary>Escribe la pregunta esta ronda.</summary>
    Redactor,

    /// <summary>Envía una estimación numérica.</summary>
    Estimator
}

/// <summary>
/// Motivo por el que una sala acepta o rechaza a un jugador.
/// Permite dar un mensaje concreto en lugar de un «no se pudo unir» genérico.
/// </summary>
public enum JoinRejection
{
    /// <summary>Admitido.</summary>
    None,

    /// <summary>La sala ya se cerró.</summary>
    RoomClosed,

    /// <summary>Las incorporaciones nuevas solo se permiten en el lobby.</summary>
    GameStarted,

    /// <summary>Se alcanzó el máximo de jugadores.</summary>
    RoomFull,

    /// <summary>Otro jugador activo ya usa ese nombre.</summary>
    NameTaken,

    /// <summary>Ese PlayerId ya tiene asiento en la sala.</summary>
    AlreadyJoined
}

/// <summary>Resultado de un intento de expulsión por parte del anfitrión.</summary>
public enum KickRejection
{
    /// <summary>Expulsado.</summary>
    None,

    /// <summary>Quien lo pide no es el anfitrión.</summary>
    NotAdmin,

    /// <summary>Solo se puede expulsar desde el lobby.</summary>
    NotInLobby,

    /// <summary>El objetivo no está en la sala.</summary>
    TargetNotFound,

    /// <summary>El anfitrión no puede expulsarse a sí mismo.</summary>
    CannotKickSelf
}
