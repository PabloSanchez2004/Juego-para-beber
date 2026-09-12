using System.Collections.Concurrent;
using Aproximados.Api.Models;

namespace Aproximados.Api.Services;

/// <summary>
/// Gestiona el ciclo de vida de todas las salas en memoria.
/// Thread-safe: usa ConcurrentDictionary para acceso concurrente entre conexiones.
/// </summary>
public sealed class RoomManager
{
    private const int RoomCodeLength = 4;
    private const int MaxRooms = 100;

    private readonly ConcurrentDictionary<string, Room> _rooms = new();
    private readonly ILogger<RoomManager> _logger;

    public RoomManager(ILogger<RoomManager> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Crea una nueva sala con código único de 4 letras mayúsculas.
    /// Devuelve null si se alcanzó el límite de salas.
    /// </summary>
    public Room? CreateRoom()
    {
        if (_rooms.Count >= MaxRooms)
        {
            _logger.LogWarning("Límite de salas alcanzado ({Max}).", MaxRooms);
            return null;
        }

        string code;
        int attempts = 0;
        do
        {
            code = GenerateCode();
            attempts++;
            if (attempts > 100)
            {
                _logger.LogError("No se pudo generar código único de sala tras 100 intentos.");
                return null;
            }
        } while (_rooms.ContainsKey(code));

        var room = new Room { Code = code };
        if (!_rooms.TryAdd(code, room))
        {
            // Colisión de concurrencia extremadamente rara; reintentar
            return CreateRoom();
        }

        _logger.LogInformation("Sala creada: {Code}", code);
        return room;
    }

    /// <summary>Obtiene una sala por código. Devuelve null si no existe.</summary>
    public Room? GetRoom(string code) =>
        _rooms.TryGetValue(code.ToUpperInvariant(), out var room) ? room : null;

    /// <summary>Elimina una sala del registro.</summary>
    public void RemoveRoom(string code)
    {
        if (_rooms.TryRemove(code.ToUpperInvariant(), out _))
            _logger.LogInformation("Sala eliminada: {Code}", code);
    }

    /// <summary>
    /// Limpia salas expiradas (inactivas más de RoomIdleTimeout o cerradas).
    /// Llamado periódicamente por el background service.
    /// </summary>
    public IReadOnlyList<string> PurgeExpiredRooms()
    {
        var now = DateTimeOffset.UtcNow;
        var expired = _rooms.Values
            .Where(r => r.Phase == GamePhase.Closed
                        || now - r.LastActivity > Room.RoomIdleTimeout)
            .Select(r => r.Code)
            .ToList();

        foreach (var code in expired)
            RemoveRoom(code);

        return expired;
    }

    private static string GenerateCode()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I, O para evitar confusión
        var rng = Random.Shared;
        return new string(Enumerable.Range(0, RoomCodeLength)
            .Select(_ => chars[rng.Next(chars.Length)])
            .ToArray());
    }
}
