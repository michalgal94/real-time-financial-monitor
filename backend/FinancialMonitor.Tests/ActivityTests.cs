using FinancialMonitor.Api;
using StackExchange.Redis;
using Xunit;

namespace FinancialMonitor.Tests;

public class ActivityTests
{
    [Fact]
    public async Task Memory_activity_is_authoritative_and_retries_do_not_change_it()
    {
        var store = new TransactionStore();
        await VerifyActivity(store, store);
    }

    [RedisFact]
    public async Task Redis_activity_survives_new_store_instances_and_cross_replica_reads()
    {
        using var connection = await ConnectionMultiplexer.ConnectAsync(Environment.GetEnvironmentVariable("TEST_REDIS_CONNECTION")!);
        var prefix = "test-activity-" + Guid.NewGuid().ToString("N");
        try
        {
            await VerifyActivity(new RedisTransactionStore(connection, 1000, prefix), new RedisTransactionStore(connection, 1000, prefix));

            // Legacy records have no activity metadata.
            var legacyId = Guid.NewGuid();
            await connection.GetDatabase().HashSetAsync($"{{{prefix}}}:records", legacyId.ToString(),
                $$"""{"transactionId":"{{legacyId}}","amount":"12.50","currency":"USD","status":"Pending","timestamp":"2026-11-07T10:00:00.0000000Z","sequence":1}""");
            var restarted = new RedisTransactionStore(connection, 1000, prefix);
            Assert.Null((await restarted.GetAsync(legacyId))!.Activity);
            var updated = (await restarted.UpdateStatusAsync(legacyId, "Completed")).Transaction;
            Assert.Equal("Pending", updated.Activity!.PreviousStatus);
            Assert.Equal("StatusChanged", updated.Activity.Kind);
        }
        finally
        {
            await connection.GetDatabase().KeyDeleteAsync(
                [$"{{{prefix}}}:records", $"{{{prefix}}}:order", $"{{{prefix}}}:sequence", $"{{{prefix}}}:capacity"]);
        }
    }

    private static async Task VerifyActivity(ITransactionStore writer, ITransactionStore reader)
    {
        foreach (var status in new[] { "Completed", "Failed" })
        foreach (var usePatch in new[] { false, true })
        {
            var input = new TransactionInput(Guid.NewGuid(), 12.50m, "USD", "Pending", DateTimeOffset.UtcNow.AddDays(-2));
            var before = DateTimeOffset.UtcNow;
            var created = (await writer.UpsertAsync(input)).Transaction;
            Assert.Equal("Created", created.Activity!.Kind);
            Assert.Null(created.Activity.PreviousStatus);
            Assert.InRange(created.Activity.OccurredAt, before, DateTimeOffset.UtcNow);
            Assert.Equal(created, (await reader.UpsertAsync(input)).Transaction);

            var finalInput = input with { Status = status, Timestamp = input.Timestamp.AddSeconds(1) };
            var updated = (usePatch
                ? await reader.UpdateStatusAsync(input.TransactionId, status)
                : await reader.UpsertAsync(finalInput)).Transaction;
            Assert.Equal("StatusChanged", updated.Activity!.Kind);
            Assert.Equal("Pending", updated.Activity.PreviousStatus);
            Assert.InRange(updated.Activity.OccurredAt, created.Activity.OccurredAt, DateTimeOffset.UtcNow);
            Assert.Equal(updated, await writer.GetAsync(input.TransactionId));
            Assert.Contains(updated, (await writer.SnapshotAsync()).Transactions);
            Assert.Equal(updated, (await writer.UpdateStatusAsync(input.TransactionId, status)).Transaction);
            if (!usePatch) Assert.Equal(updated, (await writer.UpsertAsync(finalInput)).Transaction);
            await Assert.ThrowsAsync<TransactionConflictException>(() => writer.UpdateStatusAsync(input.TransactionId, status == "Completed" ? "Failed" : "Completed"));
            Assert.Equal(updated, await reader.GetAsync(input.TransactionId));
        }

        // A transaction first received in a terminal state was created, not transitioned.
        var direct = (await writer.UpsertAsync(new(Guid.NewGuid(), 1m, "USD", "Failed", DateTimeOffset.UtcNow))).Transaction;
        Assert.Equal("Created", direct.Activity!.Kind);
        Assert.Null(direct.Activity.PreviousStatus);
    }
}
