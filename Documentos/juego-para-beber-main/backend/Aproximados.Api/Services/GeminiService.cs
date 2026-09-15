using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Aproximados.Api.Services;

/// <summary>
/// Servicio que consulta la API de Google Gemini para:
/// 1. Obtener la respuesta numérica verificada a una pregunta.
/// 2. Generar un comentario sarcástico para el perdedor.
///
/// Usa gemini-3.5-flash-lite (el más barato y rápido para tareas cortas)
/// con Google Search grounding. El modelo está fijado: no se puede sobrescribir.
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
    private const string ModelId = "gemini-3.5-flash-lite";
    private const int StrictMaxOutputTokens = 100;

    private readonly HttpClient _http;
    private readonly ILogger<GeminiService> _logger;
    private readonly string _apiKey;

    public GeminiService(HttpClient http, ILogger<GeminiService> logger, IConfiguration config)
    {
        _http = http;
        _logger = logger;
        _apiKey = ResolveApiKey(config, logger);
        logger.LogInformation(
            "Gemini model forzado: {Model} ({Url}), MaxOutputTokens={Tokens}",
            ModelId, $"{GeminiBaseUrl}/models/{ModelId}:generateContent", StrictMaxOutputTokens);
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
            return GeminiAnswerResult.Unverifiable("No se pudo consultar la IA. Inténtalo de nuevo.");
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
                MaxOutputTokens = StrictMaxOutputTokens
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
        var url = $"{GeminiBaseUrl}/models/{ModelId}:generateContent";
        var json = JsonSerializer.Serialize(requestBody, GeminiJsonContext.Default.GeminiRequest);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(15)); // timeout de IA

        using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
        request.Headers.Add("x-goog-api-key", _apiKey);
        using var httpResponse = await _http.SendAsync(request, cts.Token);

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
                MaxOutputTokens = StrictMaxOutputTokens
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
            Eres el árbitro del juego de mesa 'Aproximados'. Tu tarea es evaluar esta pregunta: "{{question}}"

            REGLAS ESTRICTAS:
            1. SIEMPRE debes dar un número en 'CorrectAnswer'.
            2. Si el dato exacto existe (ej: altura del Everest), dalo.
            3. Si el dato exacto no existe (ej: cuántas palomas hay en una ciudad, cuántos balones caben en un coche), HAZ TU MEJOR ESTIMACIÓN LÓGICA (Problema de Fermi). NO TE NIEGUES A RESPONDER.
            4. Si las fuentes dan una horquilla o rango, usa la media aritmética de los extremos.
            5. Responde ÚNICAMENTE en formato JSON puro. CERO markdown, CERO texto fuera de las llaves.

            Formato obligatorio:
            {
              "IsValid": true,
              "CorrectAnswer": 154000,
              "Explanation": "Motivo o cálculo rápido en 1 línea"
            }
            """;
    }

    // ── Parseo robusto de la respuesta ─────────────────────────────────────
    //
    // Tres capas, en este orden:
    //   1. Limpieza por fuerza bruta (Regex): quita ```json, ``` y texto fuera del JSON.
    //   2. Deserialización tolerante (AllowTrailingCommas, comentarios, nombres alternativos).
    //   3. Fallback por Regex sobre el texto crudo: rescata CorrectAnswer aunque el JSON
    //      llegue truncado (finishReason = MAX_TOKENS) o con basura alrededor.
    // En todos los fallos se registra el rawResponse exacto para diagnosticar.

    private static readonly Regex MarkdownFenceRegex =
        new(@"```\s*(?:json)?", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex IsValidRegex =
        new(@"""?IsValid""?\s*:\s*(true|false)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex CorrectAnswerRegex =
        new(@"""?CorrectAnswer""?\s*:\s*""?(-?\d+(?:[.,]\d+)?)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly JsonDocumentOptions TolerantJsonOptions = new()
    {
        AllowTrailingCommas = true,
        CommentHandling = JsonCommentHandling.Skip,
    };

    private GeminiAnswerResult ParseAnswerResponse(JsonDocument doc)
    {
        var rawText = ExtractTextFromResponse(doc);
        var finishReason = GetFinishReason(doc);

        if (string.IsNullOrWhiteSpace(rawText))
        {
            _logger.LogWarning(
                "Gemini devolvió texto vacío. finishReason={Finish}. rawResponse={Raw}",
                finishReason, doc.RootElement.GetRawText());

            return GeminiAnswerResult.Unverifiable(finishReason == "MAX_TOKENS"
                ? "La IA agotó el límite de tokens antes de responder."
                : "Respuesta vacía de la IA.");
        }

        if (finishReason is "MAX_TOKENS" or "SAFETY" or "RECITATION")
        {
            _logger.LogWarning(
                "Gemini terminó con finishReason={Finish}; la respuesta puede estar truncada. rawResponse={Raw}",
                finishReason, rawText);
        }

        var cleaned = SanitizeGeminiJson(rawText);

        try
        {
            using var parsed = JsonDocument.Parse(cleaned, TolerantJsonOptions);
            var root = parsed.RootElement;

            string expl = ReadString(root, "Explanation", "explanation");

            // En Aproximados siempre queremos un número (dato real o estimación Fermi).
            // Si llega CorrectAnswer, se acepta aunque IsValid venga a false.
            if (TryReadNumber(root, out var value, "CorrectAnswer", "correctAnswer", "correct_answer", "value"))
            {
                string source = ReadString(root, "source", "Source");
                string unit = ReadString(root, "unit", "Unit");
                return new GeminiAnswerResult(value, unit, source, true, expl);
            }

            bool isValid = ReadBoolean(root, "IsValid", "isValid", "is_valid", "is_verifiable");
            if (!isValid)
            {
                return GeminiAnswerResult.Unverifiable(
                    string.IsNullOrWhiteSpace(expl)
                        ? "La pregunta no se puede verificar numéricamente con datos concretos."
                        : expl);
            }

            _logger.LogWarning("JSON válido pero sin CorrectAnswer numérico. rawResponse={Raw}", rawText);
            return GeminiAnswerResult.Unverifiable("La IA no devolvió un valor numérico.");

        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex,
                "JSON de Gemini inválido (finishReason={Finish}). Intentando rescate por regex. rawResponse={Raw}",
                finishReason, rawText);
            return ParseWithRegexFallback(rawText, finishReason);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error inesperado parseando Gemini. rawResponse={Raw}", rawText);
            return GeminiAnswerResult.Unverifiable("No se pudo parsear la respuesta de la IA.");
        }
    }

    /// <summary>Opción 1: limpieza por fuerza bruta antes de deserializar.</summary>
    private static string SanitizeGeminiJson(string text)
    {
        text = MarkdownFenceRegex.Replace(text, string.Empty).Trim();

        int start = text.IndexOf('{');
        int end = text.LastIndexOf('}');
        if (start >= 0 && end > start)
            text = text[start..(end + 1)];

        return text.Trim();
    }

    /// <summary>
    /// Último recurso: extrae IsValid/CorrectAnswer del texto crudo aunque el JSON
    /// esté truncado o rodeado de prosa.
    /// </summary>
    private GeminiAnswerResult ParseWithRegexFallback(string rawText, string finishReason)
    {
        var numMatch = CorrectAnswerRegex.Match(rawText);
        if (numMatch.Success &&
            double.TryParse(numMatch.Groups[1].Value.Replace(',', '.'),
                NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
        {
            _logger.LogInformation("CorrectAnswer recuperado por regex: {Value}", value);
            return new GeminiAnswerResult(
                value, string.Empty, string.Empty, true,
                "Valor recuperado de una respuesta parcial de la IA.");
        }

        return GeminiAnswerResult.Unverifiable(finishReason == "MAX_TOKENS"
            ? "La IA se quedó sin tokens antes de terminar la respuesta."
            : "No se pudo parsear la respuesta de la IA.");
    }

    private static string GetFinishReason(JsonDocument doc)
    {
        try
        {
            var root = doc.RootElement;

            if (root.TryGetProperty("promptFeedback", out var feedback) &&
                feedback.TryGetProperty("blockReason", out var block))
            {
                return $"BLOCKED:{block.GetString()}";
            }

            if (root.TryGetProperty("candidates", out var candidates) &&
                candidates.ValueKind == JsonValueKind.Array &&
                candidates.GetArrayLength() > 0 &&
                candidates[0].TryGetProperty("finishReason", out var finish))
            {
                return finish.GetString() ?? string.Empty;
            }
        }
        catch
        {
            // Solo diagnóstico; nunca debe romper el flujo.
        }

        return string.Empty;
    }

    private static bool ReadBoolean(JsonElement root, params string[] names)
    {
        foreach (var name in names)
        {
            if (!root.TryGetProperty(name, out var prop)) continue;
            return prop.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.String => bool.TryParse(prop.GetString(), out var b) && b,
                _ => false
            };
        }

        return false;
    }

    private static bool TryReadNumber(JsonElement root, out double value, params string[] names)
    {
        foreach (var name in names)
        {
            if (!root.TryGetProperty(name, out var prop)) continue;
            if (prop.ValueKind == JsonValueKind.Number)
            {
                value = prop.GetDouble();
                return true;
            }

            if (prop.ValueKind == JsonValueKind.String &&
                double.TryParse((prop.GetString() ?? string.Empty).Replace(',', '.'),
                    NumberStyles.Float, CultureInfo.InvariantCulture, out value))
            {
                return true;
            }
        }

        value = 0;
        return false;
    }

    private static string ReadString(JsonElement root, params string[] names)
    {
        foreach (var name in names)
        {
            if (root.TryGetProperty(name, out var prop))
                return prop.GetString() ?? string.Empty;
        }

        return string.Empty;
    }

    /// <summary>
    /// Concatena todas las partes de texto del primer candidato.
    /// Antes solo se leía parts[0]: con grounding o "thinking" la respuesta puede
    /// venir dividida en varias partes, y parts[0] puede ser un resumen de razonamiento.
    /// </summary>
    private static string ExtractTextFromResponse(JsonDocument doc)
    {
        try
        {
            if (!doc.RootElement.TryGetProperty("candidates", out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array ||
                candidates.GetArrayLength() == 0)
            {
                return string.Empty;
            }

            if (!candidates[0].TryGetProperty("content", out var content) ||
                !content.TryGetProperty("parts", out var parts) ||
                parts.ValueKind != JsonValueKind.Array)
            {
                return string.Empty;
            }

            var sb = new StringBuilder();
            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty("thought", out var thought) &&
                    thought.ValueKind == JsonValueKind.True)
                {
                    continue; // resumen de razonamiento, no es la respuesta
                }

                if (part.TryGetProperty("text", out var textProp) &&
                    textProp.ValueKind == JsonValueKind.String)
                {
                    sb.Append(textProp.GetString());
                }
            }

            return sb.ToString();
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
            IsValid = new GeminiSchemaTypeProperty { Type = "boolean" },
            CorrectAnswer = new GeminiSchemaTypeProperty { Type = "number" },
            Explanation = new GeminiSchemaTypeProperty { Type = "string" }
        },
        Required = ["IsValid", "CorrectAnswer", "Explanation"]
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
    public int MaxOutputTokens { get; set; } = 100;

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
    [JsonPropertyName("IsValid")]
    public GeminiSchemaTypeProperty IsValid { get; set; } = new();

    [JsonPropertyName("CorrectAnswer")]
    public GeminiSchemaTypeProperty CorrectAnswer { get; set; } = new();

    [JsonPropertyName("Explanation")]
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
