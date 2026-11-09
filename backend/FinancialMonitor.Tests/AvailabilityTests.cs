using System.Net;
using FinancialMonitor.Api;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;
using Xunit;

namespace FinancialMonitor.Tests;

public class AvailabilityTests
{
    [Fact]
    public async Task Shared_storage_outage_returns_503_and_fails_readiness_without_failing_liveness()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureServices(services => services.AddSingleton<ITransactionStore>(new UnavailableStore())));
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/health/ready")).StatusCode);
        var response = await client.GetAsync("/api/transactions");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("Shared storage unavailable", await response.Content.ReadAsStringAsync());
    }

    private sealed class UnavailableStore : ITransactionStore
    {
        private static Exception Offline() => new RedisConnectionException(ConnectionFailureType.UnableToConnect, "Simulated dependency outage");
        public Task<UpsertResult> UpsertAsync(TransactionInput input) => throw Offline();
        public Task<UpsertResult> UpdateStatusAsync(Guid id, string status) => throw Offline();
        public Task<TransactionSnapshot> SnapshotAsync() => throw Offline();
        public Task<TransactionRecord?> GetAsync(Guid id) => throw Offline();
    }
}
