using System.Net;
using System.Net.Http.Json;
using FinancialMonitor.Api;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace FinancialMonitor.Tests;

public class ApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient client;
    public ApiTests(WebApplicationFactory<Program> factory) => client = factory.CreateClient();

    [Fact]
    public async Task Http_contract_supports_create_retry_transition_and_conflict()
    {
        var input = new TransactionInput(Guid.NewGuid(), 12.50m, "USD", "Pending", DateTimeOffset.UtcNow);
        var created = await client.PostAsJsonAsync("/api/transactions", input);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(created.Headers.Location)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/transactions", input)).StatusCode);
        var completed = input with { Status = "Completed" };
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/transactions", completed)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/transactions", input)).StatusCode);
        var snapshot = await client.GetFromJsonAsync<TransactionSnapshot>("/api/transactions");
        Assert.Contains(snapshot!.Transactions, x => x.TransactionId == input.TransactionId && x.Status == "Completed");
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"transactionId\":\"not-a-uuid\"}")]
    [InlineData("{\"amount\":\"invalid\"}")]
    public async Task Invalid_payload_returns_bad_request(string body)
    {
        using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/transactions", content)).StatusCode);
    }

    [Fact]
    public async Task Health_and_missing_transaction_have_expected_statuses()
    {
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/transactions/{Guid.NewGuid()}")).StatusCode);
    }
}
