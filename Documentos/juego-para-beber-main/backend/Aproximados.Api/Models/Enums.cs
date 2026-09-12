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
