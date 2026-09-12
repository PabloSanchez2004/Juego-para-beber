namespace Aproximados.Api.Services;

/// <summary>
/// Background service que limpia salas expiradas cada 5 minutos.
/// </summary>
public sealed class RoomCleanupService : BackgroundService
{
    private static readonly TimeSpan CleanupInterval = TimeSpan.FromMinutes(5);

    private readonly RoomManager _roomManager;
    private readonly ILogger<RoomCleanupService> _logger;

    public RoomCleanupService(RoomManager roomManager, ILogger<RoomCleanupService> logger)
    {
        _roomManager = roomManager;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("RoomCleanupService iniciado.");

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(CleanupInterval, stoppingToken);

            try
            {
                _roomManager.PurgeTimedOutPlayers();
                var removed = _roomManager.PurgeExpiredRooms();
                if (removed.Count > 0)
                    _logger.LogInformation("Salas expiradas eliminadas: {Codes}", string.Join(", ", removed));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error en limpieza de salas.");
            }
        }
    }
}
