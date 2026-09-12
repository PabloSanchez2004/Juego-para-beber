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
// [RELLENAR_AQUI_PABLO: Reemplaza los orígenes de CORS con la URL real de tu
//  frontend Angular desplegado. En desarrollo, http://localhost:4200 es correcto.
//  En producción, usa la URL exacta (ej: https://aproximados.tudominio.com).
//  NUNCA uses AllowAnyOrigin() en producción con AllowCredentials().
// ]
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>()
    ?? ["http://localhost:4200"];

builder.Services.AddCors(options =>
{
    options.AddPolicy("AproximadosPolicy", policy =>
    {
        policy
            .WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials(); // Requerido para SignalR WebSockets
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
