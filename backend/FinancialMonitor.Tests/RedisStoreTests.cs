using FinancialMonitor.Api;
using StackExchange.Redis;
using Xunit;

namespace FinancialMonitor.Tests;

public sealed class RedisFactAttribute : FactAttribute
{
    public RedisFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("TEST_REDIS_CONNECTION")))
            Skip = "Set TEST_REDIS_CONNECTION to run real Redis integration tests.";
    }
}

public class RedisStoreTests
{
    private static TransactionInput Input(Guid? id = null) => new(id ?? Guid.NewGuid(), 1500.50m, "USD", "Pending", DateTimeOffset.UtcNow);

    [RedisFact]
    public async Task Independent_connections_share_atomic_sequences_snapshots_and_exact_money()
    {
        using var first = await Connect();
        using var second = await Connect();
        var prefix = "test-" + Guid.NewGuid().ToString("N");
        try
        {
            var a = new RedisTransactionStore(first, 1000, prefix);
            var b = new RedisTransactionStore(second, 1000, prefix);
            await Task.WhenAll(Enumerable.Range(0, 200).Select(i => (i % 2 == 0 ? a : b).UpsertAsync(Input())));
            var snapshot = await b.SnapshotAsync();
            Assert.Equal(200, snapshot.Watermark);
            Assert.Equal(200, snapshot.Transactions.Count);
            Assert.Equal(Enumerable.Range(1, 200).Reverse().Select(x => (long)x), snapshot.Transactions.Select(x => x.Sequence));
            Assert.All(snapshot.Transactions, item => Assert.Equal(1500.50m, item.Amount));
            var exact = Input() with { Amount = 999999999.99m, Timestamp = DateTimeOffset.Parse("2026-11-07T10:00:00.1234567Z") };
            await a.UpsertAsync(exact);
            var stored = await b.GetAsync(exact.TransactionId);
            Assert.Equal(exact.Amount, stored!.Amount);
            Assert.Equal(exact.Timestamp, stored.Timestamp);
            Assert.False((await b.UpsertAsync(exact with { Timestamp = exact.Timestamp.ToOffset(TimeSpan.FromHours(2)) })).Changed);
        }
        finally { await Cleanup(first, prefix); }
    }

    [RedisFact]
    public async Task Concurrent_duplicate_ingestion_and_competing_resolutions_are_atomic_across_replicas()
    {
        using var connection = await Connect();
        var prefix = "test-" + Guid.NewGuid().ToString("N");
        try
        {
            var a = new RedisTransactionStore(connection, 1000, prefix);
            var b = new RedisTransactionStore(connection, 1000, prefix);
            var input = Input();
            var retries = await Task.WhenAll(Enumerable.Range(0, 100).Select(i => (i % 2 == 0 ? a : b).UpsertAsync(input)));
            Assert.Single(retries, result => result.Changed);
            Assert.Equal(1, (await b.SnapshotAsync()).Watermark);
            async Task<bool> Resolve(RedisTransactionStore store, string status)
            {
                try { await store.UpdateStatusAsync(input.TransactionId, status); return true; }
                catch (TransactionConflictException) { return false; }
            }
            var resolutions = await Task.WhenAll(Resolve(a, "Completed"), Resolve(b, "Failed"));
            Assert.Single(resolutions, success => success);
            Assert.Equal(2, (await a.SnapshotAsync()).Watermark);
            var current = (await a.GetAsync(input.TransactionId))!;
            Assert.False((await b.UpdateStatusAsync(input.TransactionId, current.Status)).Changed);
        }
        finally { await Cleanup(connection, prefix); }
    }

    [RedisFact]
    public async Task Eviction_missing_updates_and_stale_versions_match_the_memory_contract()
    {
        using var connection = await Connect();
        var prefix = "test-" + Guid.NewGuid().ToString("N");
        try
        {
            var store = new RedisTransactionStore(connection, 2, prefix);
            var first = Input();
            await store.UpsertAsync(first);
            var second = Input();
            await store.UpsertAsync(second);
            await Assert.ThrowsAsync<TransactionConflictException>(() => store.UpsertAsync(second with { Status = "Completed", Timestamp = second.Timestamp.AddTicks(-1) }));
            await store.UpsertAsync(Input());
            Assert.Null(await store.GetAsync(first.TransactionId));
            await Assert.ThrowsAsync<TransactionNotFoundException>(() => store.UpdateStatusAsync(first.TransactionId, "Completed"));
            Assert.Equal(2, (await store.SnapshotAsync()).Transactions.Count);
            Assert.Equal(3, (await store.SnapshotAsync()).Watermark);
        }
        finally { await Cleanup(connection, prefix); }
    }

    [RedisFact]
    public async Task Mismatched_replica_capacity_is_rejected_instead_of_silently_losing_data()
    {
        using var connection = await Connect();
        var prefix = "test-" + Guid.NewGuid().ToString("N");
        try
        {
            var a = new RedisTransactionStore(connection, 100, prefix);
            await a.UpsertAsync(Input());
            var misconfigured = new RedisTransactionStore(connection, 1, prefix);
            await Assert.ThrowsAsync<RedisServerException>(() => misconfigured.UpsertAsync(Input()));
            await Assert.ThrowsAsync<RedisServerException>(() => misconfigured.SnapshotAsync());
            Assert.Single((await a.SnapshotAsync()).Transactions);
        }
        finally { await Cleanup(connection, prefix); }
    }

    private static Task<ConnectionMultiplexer> Connect() => ConnectionMultiplexer.ConnectAsync(Environment.GetEnvironmentVariable("TEST_REDIS_CONNECTION")!);
    private static Task<long> Cleanup(IConnectionMultiplexer connection, string prefix) => connection.GetDatabase().KeyDeleteAsync(
        [$"{{{prefix}}}:records", $"{{{prefix}}}:order", $"{{{prefix}}}:sequence", $"{{{prefix}}}:capacity"]);
}
