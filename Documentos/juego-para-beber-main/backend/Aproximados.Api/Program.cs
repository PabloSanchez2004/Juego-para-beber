using System.Net;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json;
using System.Text.Json.Serialization;
using Aproximados.Api.Hubs;
using Aproximados.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Servicios ──────────────────────────────────────────────────────────────

builder.Services.AddSingleton<RoomManager>();
builder.Services.AddSingleton<GameRateLimitFilter>();
builder.Services.AddHostedService<RoomCleanupService>();

builder.Services.AddHttpClient<GeminiService>();
builder.Services.AddSingleton<GeminiService>();

builder.Services.AddSignalR(options =>
{
    options.AddFilter<GameRateLimitFilter>();
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
    options.MaximumReceiveMessageSize = 32 * 1024; // 32 KB
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(60);
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
})
.AddJsonProtocol(options =>
{
    options.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.PayloadSerializerOptions.PropertyNameCaseInsensitive = true;
    options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

// ── CORS ───────────────────────────────────────────────────────────────────
// AllowAnyOrigin() no se puede combinar con AllowCredentials() (SignalR lo exige).
// Only exact origins configured for this deployment are trusted.
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>()
    ?? ["http://localhost:4200", "http://localhost:4300"];
var allowLanOrigins = builder.Environment.IsDevelopment();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AproximadosPolicy", policy =>
    {
        policy
            .SetIsOriginAllowed(origin => IsAllowedCorsOrigin(origin, allowedOrigins, allowLanOrigins))
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// ── Logging ────────────────────────────────────────────────────────────────
builder.Logging.ClearProviders();
builder.Logging.AddConsole();

var app = builder.Build();

// ── Middleware ─────────────────────────────────────────────────────────────

app.UseCors("AproximadosPolicy");
// CORS alone does not protect the WebSocket upgrade.
app.Use(async (context, next) =>
{
    var origin = context.Request.Headers.Origin.ToString();
    if (context.Request.Path.StartsWithSegments("/gamehub") &&
        !string.IsNullOrEmpty(origin) && !IsAllowedCorsOrigin(origin, allowedOrigins, allowLanOrigins))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    await next();
});

// Headers de seguridad básicos
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    await next();
});

app.MapHub<GameHub>("/gamehub");

// Health check básico
app.MapGet("/health", () => Results.Ok(new { status = "ok", timestamp = DateTimeOffset.UtcNow }));

app.Run();

static bool IsAllowedCorsOrigin(string? origin, string[] configuredOrigins, bool allowLan)
{
    if (string.IsNullOrWhiteSpace(origin)) return false;
    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
    if (uri.Scheme is not ("https" or "http")) return false;
    if (configuredOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)) return true;
    if (!allowLan || uri.Scheme != "http") return false;
    if (uri.Host is "localhost" or "127.0.0.1" or "::1") return true;
    return IPAddress.TryParse(uri.Host, out var ip) && IsPrivateIpv4(ip);
}

static bool IsPrivateIpv4(IPAddress ip)
{
    if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return false;
    var bytes = ip.GetAddressBytes();
    return bytes[0] == 10
        || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
        || (bytes[0] == 192 && bytes[1] == 168)
        || (bytes[0] == 169 && bytes[1] == 254);
}
