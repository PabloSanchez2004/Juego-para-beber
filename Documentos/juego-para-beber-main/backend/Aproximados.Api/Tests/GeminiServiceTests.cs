using System.Net;
using System.Text;
using System.Text.Json;
using Aproximados.Api.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Aproximados.Api.Tests;

public class GeminiServiceTests
{
    [Fact]
    public async Task PreservesConfiguredModelAndUsesGroundingSource()
    {
        var handler = new FakeGeminiHandler("{\"IsValid\":true,\"CorrectAnswer\":206,\"Explanation\":\"Huesos\"}");
        var result = await Service(handler).GetNumericAnswerAsync("¿Cuántos huesos?");
        Assert.True(result.IsVerifiable);
        Assert.Equal(206, result.Value);
        Assert.Equal("https://example.org/reference", result.Source);
        Assert.Equal("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", handler.RequestUri);
        Assert.Contains("google_search", handler.RequestBody);
        Assert.DoesNotContain("test-key", handler.RequestUri);
    }

    [Theory]
    [InlineData("{\"CorrectAnswer\":\"NaN\"}")]
    [InlineData("{\"CorrectAnswer\":\"Infinity\"}")]
    [InlineData("{\"CorrectAnswer\":1e999}")]
    [InlineData("{\"CorrectAnswer\":1e999,\"Explanation\":")]
    [InlineData("{\"CorrectAnswer\":1e+")]
    public async Task NonFiniteOrIncompleteNumbersAreNeverAccepted(string response)
    {
        var result = await Service(new FakeGeminiHandler(response)).GetNumericAnswerAsync("¿Cuánto?");
        Assert.False(result.IsVerifiable);
    }

    [Fact]
    public async Task PartialScientificNotationKeepsTheExponent()
    {
        var result = await Service(new FakeGeminiHandler("{\"CorrectAnswer\":6.022e23,\"Explanation\":"))
            .GetNumericAnswerAsync("¿Cuánto?");
        Assert.True(result.IsVerifiable);
        Assert.Equal(6.022e23, result.Value);
        Assert.Equal("https://example.org/reference", result.Source);
    }

    internal static GeminiService Service(HttpMessageHandler handler) => new(
        new HttpClient(handler), NullLogger<GeminiService>.Instance,
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["GEMINI_API_KEY"] = "test-key" }).Build());

    internal sealed class FakeGeminiHandler(string text) : HttpMessageHandler
    {
        public string RequestUri { get; private set; } = "";
        public string RequestBody { get; private set; } = "";
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            RequestUri = request.RequestUri!.ToString();
            RequestBody = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(JsonSerializer.Serialize(new
                {
                    candidates = new[] { new {
                        content = new { parts = new[] { new { text } } },
                        finishReason = "STOP",
                        groundingMetadata = new { groundingChunks = new[] { new { web = new { uri = "https://example.org/reference", title = "Referencia" } } } }
                    } }
                }), Encoding.UTF8, "application/json")
            };
        }
    }
}
