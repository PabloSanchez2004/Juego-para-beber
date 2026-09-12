using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Aproximados.Api.Services;

/// <summary>
/// Servicio que consulta la API de Google Gemini para:
/// 1. Obtener la respuesta numérica verificada a una pregunta.
/// 2. Generar un comentario sarcástico para el perdedor.
///
/// Usa Gemini Flash (por defecto gemini-3.8-flash) con Google Search grounding.
///
/// IMPORTANTE: La API key se lee de la variable de entorno GEMINI_API_KEY.
/// Nunca se expone al frontend.
/// </summary>
public sealed class GeminiService
{
    // [RELLENAR_AQUI_PABLO: Configura la variable de entorno GEMINI_API_KEY
    //  en tu servidor/contenedor con tu clave de Google AI Studio.
    //  Obtén una en: https://aistudio.google.com/app/apikey
    //  Ejemplo en Linux: export GEMINI_API_KEY="AIza..."
    //  Ejemplo en appsettings.json (NO recomendado para producción):
    //    "Gemini": { "ApiKey": "AIza..." }
    //  Ejemplo en docker-compose:
    //    environment:
    //      - GEMINI_API_KEY=AIza...
    // ]

    private const string GeminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
    private const string DefaultModelId = "gemini-3.8-flash";

    private readonly HttpClient _http;
    private readonly ILogger<GeminiService> _logger;
    private readonly string _apiKey;
    private readonly string _modelId;

    public GeminiService(HttpClient http, ILogger<GeminiService> logger, IConfiguration config)
    {
        _http = http;
        _logger = logger;
        _apiKey = ResolveApiKey(config, logger);
        _modelId = ResolveModelId(config, logger);
    }

    private static string ResolveApiKey(IConfiguration config, ILogger logger)
    {
        var candidates = new (string Source, string? Value)[]
        {
            ("GEMINI_API_KEY (configuration)", config["GEMINI_API_KEY"]),
            ("GEMINI_API_KEY (environment)", Environment.GetEnvironmentVariable("GEMINI_API_KEY")),
            ("Gemini__ApiKey (environment)", Environment.GetEnvironmentVariable("Gemini__ApiKey")),
            ("Gemini:ApiKey (configuration)", config["Gemini:ApiKey"]),
        };

        foreach (var (source, value) in candidates)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                logger.LogInformation("Gemini API key cargada desde {Source}", source);
                return value.Trim();
            }
        }

        logger.LogError(
            "GEMINI_API_KEY no configurada. En Render: Environment → GEMINI_API_KEY. " +
            "También se aceptan Gemini__ApiKey o Gemini:ApiKey. " +
            "Sin clave, las respuestas de la IA no se podrán verificar.");
        return string.Empty;
    }

    private static string ResolveModelId(IConfiguration config, ILogger logger)
    {
        var model = config["Gemini:ModelId"]
                    ?? config["GEMINI_MODEL_ID"]
                    ?? Environment.GetEnvironmentVariable("GEMINI_MODEL_ID")
                    ?? DefaultModelId;

        model = model.Trim();
        if (model.StartsWith("models/", StringComparison.OrdinalIgnoreCase))
            model = model["models/".Length..];

        logger.LogInformation("Gemini model: {Model} ({Url})", model, $"{GeminiBaseUrl}/models/{model}:generateContent");
        return model;
    }

    // ── Respuesta numérica ─────────────────────────────────────────────────

    /// <summary>
    /// Consulta Gemini con grounding para obtener la respuesta numérica a la pregunta.
    /// </summary>
    /// <returns>
    /// (Value, Source, IsVerifiable) donde IsVerifiable=false indica que la IA
    /// no pudo verificar la respuesta con fuentes reales.
    /// </returns>
    public async Task<GeminiAnswerResult> GetNumericAnswerAsync(
        string question,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            return GeminiAnswerResult.Unverifiable("API key no configurada.");
        }

        var prompt = BuildAnswerPrompt(question);
        var requestBody = BuildRequestWithGrounding(prompt, responseSchema: AnswerSchema);

        try
        {
            var response = await CallGeminiAsync(requestBody, ct);
            return ParseAnswerResponse(response);
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("Timeout consultando Gemini para pregunta: {Q}", question);
            return GeminiAnswerResult.Unverifiable("Timeout al consultar la IA.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error consultando Gemini para pregunta: {Q}", question);
            return GeminiAnswerResult.Unverifiable($"Error de IA: {ex.Message}");
        }
    }

    // ── Comentario sarcástico ──────────────────────────────────────────────

    /// <summary>
    /// Genera un comentario sarcástico en español para el perdedor de la ronda.
    /// </summary>
    public async Task<string> GetSarcasticCommentAsync(
        string loserName,
        double loserGuess,
        double correctAnswer,
        string question,
        bool alcoholFree,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            return $"¡{loserName}, eso ha sido un desastre épico! 🤦";
        }

        var drinkText = alcoholFree ? "un reto sin alcohol" : "un chupito";
        var prompt = $"""
            Eres el presentador gamberro y sarcástico del juego de beber "Aproximados".
            El jugador "{loserName}" ha perdido esta ronda.
            Pregunta: "{question}"
            Respuesta correcta: {correctAnswer}
            Su estimación: {loserGuess}
            Error: {Math.Abs(loserGuess - correctAnswer):F2} ({Math.Abs(loserGuess - correctAnswer) / Math.Max(Math.Abs(correctAnswer), 1) * 100:F1}% de error)
            Se lleva {drinkText} como castigo.
            
            Escribe UN comentario sarcástico, divertido e informal en español de España (máx 2 frases, 120 caracteres).
            Usa emojis. No seas cruel, solo gamberro. Responde SOLO el comentario, sin comillas ni explicaciones.
            """;

        var requestBody = new GeminiRequest
        {
            Contents = [new GeminiContent { Parts = [new GeminiPart { Text = prompt }] }],
            GenerationConfig = new GeminiGenerationConfig
            {
                Temperature = 1.2f,
                MaxOutputTokens = 150
            }
        };

        try
        {
            var response = await CallGeminiAsync(requestBody, ct);
            var text = ExtractTextFromResponse(response);
            return string.IsNullOrWhiteSpace(text)
                ? $"¡{loserName}, eso ha sido legendariamente malo! 🏆"
                : text.Trim();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo generar comentario sarcástico.");
            return $"¡{loserName}, ni el GPS te salva! 🗺️";
        }
    }

    // ── Implementación interna ─────────────────────────────────────────────

    private async Task<JsonDocument> CallGeminiAsync(GeminiRequest requestBody, CancellationToken ct)
    {
        var url = $"{GeminiBaseUrl}/models/{_modelId}:generateContent?key={_apiKey}";
        var json = JsonSerializer.Serialize(requestBody, GeminiJsonContext.Default.GeminiRequest);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(15)); // timeout de IA

        var httpResponse = await _http.PostAsync(url, content, cts.Token);

        if (!httpResponse.IsSuccessStatusCode)
        {
            var errorBody = await httpResponse.Content.ReadAsStringAsync(ct);
            _logger.LogError("Gemini API error {Status}: {Body}", httpResponse.StatusCode, errorBody);
            throw new HttpRequestException($"Gemini API devolvió {httpResponse.StatusCode}: {errorBody}");
        }

        var responseJson = await httpResponse.Content.ReadAsStringAsync(ct);
        return JsonDocument.Parse(responseJson);
    }

    private static GeminiRequest BuildRequestWithGrounding(string prompt, GeminiResponseSchema? responseSchema = null)
    {
        var request = new GeminiRequest
        {
            Contents = [new GeminiContent { Parts = [new GeminiPart { Text = prompt }] }],
            Tools = [new GeminiTool { GoogleSearch = new GoogleSearchTool() }],
            GenerationConfig = new GeminiGenerationConfig
            {
                Temperature = 0.1f,
                MaxOutputTokens = 512
            }
        };

        if (responseSchema is not null)
        {
            request.GenerationConfig.ResponseMimeType = "application/json";
            request.GenerationConfig.ResponseSchema = responseSchema;
        }

        return request;
    }

    private static string BuildAnswerPrompt(string question)
    {
        return $$"""
            Eres un asistente de verificación de datos para el juego "Aproximados".
            Tu tarea es encontrar la respuesta numérica exacta y verificable a esta pregunta usando búsqueda web.
            
            Pregunta: "{{question}}"
            
            Reglas:
            1. Busca la respuesta en fuentes fiables y actuales.
            2. "value" debe ser UN solo número (entero o decimal). Nunca un rango, lista, intervalo ni texto.
            3. Si las fuentes dan una horquilla o rango (ej: 10-20, "entre 100 y 150"), usa la media aritmética de los extremos. En explanation indica el rango original y que se usó el punto medio.
            4. Si la respuesta puede variar (ej: precio de bolsa), usa el valor más reciente verificable, un solo número.
            5. Si NO puedes verificar la respuesta con certeza, indica is_verifiable: false.
            6. Responde SOLO en el formato JSON especificado. No añadas markdown ni texto fuera del JSON.
            
            Responde en JSON con este esquema exacto:
            {
              "value": <número>,
              "unit": "<unidad de medida o vacío>",
              "source": "<URL o nombre de la fuente>",
              "is_verifiable": <true|false>,
              "explanation": "<breve explicación en español>"
            }
            """;
    }

    private static GeminiAnswerResult ParseAnswerResponse(JsonDocument doc)
    {
        try
        {
            var text = ExtractTextFromResponse(doc);
            if (string.IsNullOrWhiteSpace(text))
                return GeminiAnswerResult.Unverifiable("Respuesta vacía de la IA.");

            // Limpiar posibles bloques de código markdown
            text = text.Trim();
            if (text.StartsWith("```json")) text = text[7..];
            if (text.StartsWith("```")) text = text[3..];
            if (text.EndsWith("```")) text = text[..^3];
            text = text.Trim();

            using var parsed = JsonDocument.Parse(text);
            var root = parsed.RootElement;

            bool isVerifiable = root.TryGetProperty("is_verifiable", out var iv) && iv.GetBoolean();
            if (!isVerifiable)
            {
                var explanation = root.TryGetProperty("explanation", out var exp)
                    ? exp.GetString() ?? "No verificable."
                    : "No verificable.";
                return GeminiAnswerResult.Unverifiable(explanation);
            }

            if (!root.TryGetProperty("value", out var valProp))
                return GeminiAnswerResult.Unverifiable("La IA no devolvió un valor numérico.");

            double value = valProp.ValueKind == JsonValueKind.Number
                ? valProp.GetDouble()
                : double.Parse(valProp.GetString() ?? "0");

            string source = root.TryGetProperty("source", out var src) ? src.GetString() ?? "" : "";
            string unit = root.TryGetProperty("unit", out var u) ? u.GetString() ?? "" : "";
            string expl = root.TryGetProperty("explanation", out var e) ? e.GetString() ?? "" : "";

            return new GeminiAnswerResult(value, unit, source, true, expl);
        }
        catch (Exception)
        {
            return GeminiAnswerResult.Unverifiable("No se pudo parsear la respuesta de la IA.");
        }
    }

    private static string ExtractTextFromResponse(JsonDocument doc)
    {
        try
        {
            return doc.RootElement
                .GetProperty("candidates")[0]
                .GetProperty("content")
                .GetProperty("parts")[0]
                .GetProperty("text")
                .GetString() ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    // ── Schema JSON para respuesta estructurada ────────────────────────────

    private static readonly GeminiResponseSchema AnswerSchema = new()
    {
        Type = "object",
        Properties = new GeminiSchemaProperties
        {
            Value = new GeminiSchemaTypeProperty { Type = "number" },
            Unit = new GeminiSchemaTypeProperty { Type = "string" },
            Source = new GeminiSchemaTypeProperty { Type = "string" },
            IsVerifiable = new GeminiSchemaTypeProperty { Type = "boolean" },
            Explanation = new GeminiSchemaTypeProperty { Type = "string" }
        },
        Required = ["value", "unit", "source", "is_verifiable", "explanation"]
    };
}

// ── DTOs de resultado ──────────────────────────────────────────────────────

public sealed record GeminiAnswerResult(
    double Value,
    string Unit,
    string Source,
    bool IsVerifiable,
    string Explanation)
{
    public static GeminiAnswerResult Unverifiable(string reason) =>
        new(0, string.Empty, string.Empty, false, reason);
}

// ── Modelos de request Gemini ──────────────────────────────────────────────

public sealed class GeminiRequest
{
    [JsonPropertyName("contents")]
    public List<GeminiContent> Contents { get; set; } = [];

    [JsonPropertyName("tools")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<GeminiTool>? Tools { get; set; }

    [JsonPropertyName("generationConfig")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public GeminiGenerationConfig? GenerationConfig { get; set; }
}

public sealed class GeminiContent
{
    [JsonPropertyName("parts")]
    public List<GeminiPart> Parts { get; set; } = [];
}

public sealed class GeminiPart
{
    [JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;
}

public sealed class GeminiTool
{
    [JsonPropertyName("google_search")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public GoogleSearchTool? GoogleSearch { get; set; }
}

public sealed class GoogleSearchTool { }

public sealed class GeminiGenerationConfig
{
    [JsonPropertyName("temperature")]
    public float Temperature { get; set; } = 0.1f;

    [JsonPropertyName("maxOutputTokens")]
    public int MaxOutputTokens { get; set; } = 512;

    [JsonPropertyName("responseMimeType")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ResponseMimeType { get; set; }

    [JsonPropertyName("responseSchema")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public GeminiResponseSchema? ResponseSchema { get; set; }
}

public sealed class GeminiResponseSchema
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "object";

    [JsonPropertyName("properties")]
    public GeminiSchemaProperties Properties { get; set; } = new();

    [JsonPropertyName("required")]
    public List<string> Required { get; set; } = [];
}

public sealed class GeminiSchemaProperties
{
    [JsonPropertyName("value")]
    public GeminiSchemaTypeProperty Value { get; set; } = new();

    [JsonPropertyName("unit")]
    public GeminiSchemaTypeProperty Unit { get; set; } = new();

    [JsonPropertyName("source")]
    public GeminiSchemaTypeProperty Source { get; set; } = new();

    [JsonPropertyName("is_verifiable")]
    public GeminiSchemaTypeProperty IsVerifiable { get; set; } = new();

    [JsonPropertyName("explanation")]
    public GeminiSchemaTypeProperty Explanation { get; set; } = new();
}

public sealed class GeminiSchemaTypeProperty
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "string";
}

[JsonSerializable(typeof(GeminiRequest))]
[JsonSerializable(typeof(GeminiContent))]
[JsonSerializable(typeof(GeminiPart))]
[JsonSerializable(typeof(GeminiTool))]
[JsonSerializable(typeof(GoogleSearchTool))]
[JsonSerializable(typeof(GeminiGenerationConfig))]
[JsonSerializable(typeof(GeminiResponseSchema))]
[JsonSerializable(typeof(GeminiSchemaProperties))]
[JsonSerializable(typeof(GeminiSchemaTypeProperty))]
[JsonSerializable(typeof(List<string>))]
internal partial class GeminiJsonContext : JsonSerializerContext { }
