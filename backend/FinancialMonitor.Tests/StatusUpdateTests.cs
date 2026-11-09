using System.Net;
using System.Net.Http.Json;
using FinancialMonitor.Api;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace FinancialMonitor.Tests;

public class StatusUpdateTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient client;
    public StatusUpdateTests(WebApplicationFactory<Program> factory) => client = factory.CreateClient();

    [Theory]
    [InlineData("Completed")]
    [InlineData("Failed")]
    public async Task Resolving_pending_updates_one_existing_record_and_retries_are_safe(string status)
    {
        var input = new TransactionInput(Guid.NewGuid(), 12.50m, "USD", "Pending", DateTimeOffset.UtcNow);
        await client.PostAsJsonAsync("/api/transactions", input);
        var response = await client.PatchAsJsonAsync($"/api/transactions/{input.TransactionId}/status", new { status });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<TransactionRecord>();
        Assert.Equal(status, updated!.Status);
        Assert.Equal(input.TransactionId, updated.TransactionId);
        Assert.Equal(input.Amount, updated.Amount);
        var retry = await client.PatchAsJsonAsync($"/api/transactions/{input.TransactionId}/status", new { status });
        Assert.Equal(updated.Sequence, (await retry.Content.ReadFromJsonAsync<TransactionRecord>())!.Sequence);
        var snapshot = await client.GetFromJsonAsync<TransactionSnapshot>("/api/transactions");
        Assert.Single(snapshot!.Transactions, x => x.TransactionId == input.TransactionId);
    }

    [Fact]
    public async Task Missing_id_is_not_created_by_a_status_update()
    {
        var id = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await client.PatchAsJsonAsync($"/api/transactions/{id}/status", new { status = "Completed" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/transactions/{id}")).StatusCode);
    }

    [Theory]
    [InlineData("Completed")]
    [InlineData("Failed")]
    public async Task One_resolution_advances_the_global_counter_once_even_when_another_transaction_intervenes(string status)
    {
        var input = new TransactionInput(Guid.NewGuid(), 12.50m, "USD", "Pending", DateTimeOffset.UtcNow);
        var createdResponse = await client.PostAsJsonAsync("/api/transactions", input);
        var created = (await createdResponse.Content.ReadFromJsonAsync<TransactionRecord>())!;
        await client.PostAsJsonAsync("/api/transactions", input with { TransactionId = Guid.NewGuid() });
        var before = (await client.GetFromJsonAsync<TransactionSnapshot>("/api/transactions"))!;

        var resolvedResponse = await client.PatchAsJsonAsync($"/api/transactions/{input.TransactionId}/status", new { status });
        var resolved = (await resolvedResponse.Content.ReadFromJsonAsync<TransactionRecord>())!;
        var after = (await client.GetFromJsonAsync<TransactionSnapshot>("/api/transactions"))!;

        Assert.Equal(before.Watermark + 1, resolved.Sequence);
        Assert.Equal(before.Watermark + 1, after.Watermark);
        Assert.Equal(created.Sequence + 2, resolved.Sequence);
        Assert.Equal(before.Transactions.Count, after.Transactions.Count);
        await client.PatchAsJsonAsync($"/api/transactions/{input.TransactionId}/status", new { status });
        Assert.Equal(after.Watermark, (await client.GetFromJsonAsync<TransactionSnapshot>("/api/transactions"))!.Watermark);
    }

    [Fact]
    public async Task Concurrent_competing_resolutions_have_exactly_one_winner()
    {
        var input = new TransactionInput(Guid.NewGuid(), 1m, "USD", "Pending", DateTimeOffset.UtcNow);
        await client.PostAsJsonAsync("/api/transactions", input);
        var responses = await Task.WhenAll(new[] { "Completed", "Failed" }.Select(status =>
            client.PatchAsJsonAsync($"/api/transactions/{input.TransactionId}/status", new { status })));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict);
    }

    [Theory]
    [InlineData("Pending")]
    [InlineData("Success")]
    public async Task Invalid_resolution_status_returns_400(string status) =>
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PatchAsJsonAsync($"/api/transactions/{Guid.NewGuid()}/status", new { status })).StatusCode);
}
