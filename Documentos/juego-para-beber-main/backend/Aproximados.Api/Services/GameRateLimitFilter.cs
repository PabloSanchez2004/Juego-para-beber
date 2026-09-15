using Microsoft.AspNetCore.SignalR;
using System.Threading.RateLimiting;

namespace Aproximados.Api.Services;

/// <summary>Process-wide budgets also apply to WebSocket hub invocations.</summary>
public sealed class GameRateLimitFilter : IHubFilter, IDisposable
{
    private readonly TokenBucketRateLimiter _rooms = Create(30);
    private readonly TokenBucketRateLimiter _questions = Create(120);
    private readonly TokenBucketRateLimiter _other = Create(1200);

    private static TokenBucketRateLimiter Create(int count) => new(new TokenBucketRateLimiterOptions
    {
        TokenLimit = count, TokensPerPeriod = count, ReplenishmentPeriod = TimeSpan.FromMinutes(1),
        AutoReplenishment = true, QueueLimit = 0
    });

    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext context,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        const string key = "rateWindow";
        if (!context.Context.Items.TryGetValue(key, out var stored))
            context.Context.Items[key] = stored = new Queue<DateTimeOffset>();
        var window = (Queue<DateTimeOffset>)stored!;
        lock (window)
        {
            var now = DateTimeOffset.UtcNow;
            while (window.TryPeek(out var first) && now - first >= TimeSpan.FromMinutes(1)) window.Dequeue();
            if (window.Count >= 60) throw new HubException("Demasiadas acciones. Espera un minuto.");
            window.Enqueue(now);
        }
        var limiter = context.HubMethodName switch
        {
            "CreateRoom" => _rooms,
            "SubmitQuestion" => _questions,
            _ => _other
        };
        using var lease = limiter.AttemptAcquire();
        if (!lease.IsAcquired) throw new HubException("El juego está muy ocupado. Espera un minuto.");
        return await next(context);
    }

    public void Dispose() { _rooms.Dispose(); _questions.Dispose(); _other.Dispose(); }
}
