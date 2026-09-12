using Aproximados.Api.Hubs;
using Aproximados.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Servicios ──────────────────────────────────────────────────────────────

builder.Services.AddSingleton<RoomManager>();
builder.Services.AddHostedService<RoomCleanupService>();

builder.Services.AddHttpClient<GeminiService>();
builder.Services.AddSingleton<GeminiService>();

builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
    options.MaximumReceiveMessageSize = 32 * 1024; // 32 KB
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(60);
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
});

// ── CORS ───────────────────────────────────────────────────────────────────
// AllowAnyOrigin() no se puede combinar con AllowCredentials() (SignalR lo exige).
// Se validan orígenes en runtime: localhost, *.vercel.app y la lista de appsettings.
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>()
    ?? ["http://localhost:4200"];

builder.Services.AddCors(options =>
{
    options.AddPolicy("AproximadosPolicy", policy =>
    {
        policy
            .SetIsOriginAllowed(origin => IsAllowedCorsOrigin(origin, allowedOrigins))
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

static bool IsAllowedCorsOrigin(string? origin, string[] configuredOrigins)
{
    if (string.IsNullOrWhiteSpace(origin)) return false;
    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;

    if (uri.Host is "localhost" or "127.0.0.1") return true;
    if (uri.Host.EndsWith(".vercel.app", StringComparison.OrdinalIgnoreCase)) return true;

    return configuredOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase);
}
