using FinancialMonitor.Api;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace FinancialMonitor.Tests;

public class TransactionTests
{
    private static TransactionInput Input(Guid? id = null, string status = "Pending") =>
        new(id ?? Guid.NewGuid(), 1500.50m, "USD", status, DateTimeOffset.UtcNow);

    [Fact]
    public void Validation_rejects_invalid_contract()
    {
        var invalid = new TransactionInput(Guid.Empty, -1, "usd", "Success", default);
        Assert.Equal(5, TransactionValidator.Validate(invalid).Count);
        Assert.Empty(TransactionValidator.Validate(Input()));
    }

    [Fact]
    public void Storage_evicts_oldest_and_returns_detached_newest_first_snapshot()
    {
        var store = new TransactionStore(2);
        store.Upsert(Input());
        var detached = store.Snapshot();
        var second = store.Upsert(Input()).Transaction;
        var third = store.Upsert(Input()).Transaction;
        Assert.Single(detached.Transactions);
        Assert.Equal(new[] { third, second }, store.Snapshot().Transactions);
        Assert.Equal(3, store.Snapshot().Watermark);
    }

    [Fact]
    public void Retries_are_idempotent_and_only_pending_can_transition()
    {
        var store = new TransactionStore(10);
        var input = Input();
        Assert.True(store.Upsert(input).Changed);
        Assert.False(store.Upsert(input).Changed);
        var completed = input with { Status = "Completed", Timestamp = input.Timestamp.AddSeconds(1) };
        Assert.True(store.Upsert(completed).Changed);
        Assert.Throws<TransactionConflictException>(() => store.Upsert(completed with { Status = "Failed" }));
        Assert.Throws<TransactionConflictException>(() => store.Upsert(input));
        Assert.Equal(2, store.Snapshot().Watermark);
    }

    [Fact]
    public async Task Concurrent_writes_reads_and_duplicate_ids_are_consistent()
    {
        var store = new TransactionStore(1000);
        var input = Input();
        await Task.WhenAll(Enumerable.Range(0, 200).Select(_ => Task.Run(() => store.Upsert(input))));
        Assert.Single(store.Snapshot().Transactions);
        Assert.Equal(1, store.Snapshot().Watermark);
        await Task.WhenAll(Enumerable.Range(0, 500).Select(_ => Task.Run(() =>
        {
            store.Upsert(Input());
            var snapshot = store.Snapshot();
            Assert.Equal(snapshot.Transactions.Count, snapshot.Transactions.Select(x => x.TransactionId).Distinct().Count());
            Assert.True(snapshot.Transactions.Zip(snapshot.Transactions.Skip(1)).All(p => p.First.Sequence > p.Second.Sequence));
        })));
        Assert.Equal(501, store.Snapshot().Transactions.Count);
        Assert.Equal(501, store.Snapshot().Watermark);
    }

    [Fact]
    public async Task Processor_broadcasts_committed_updates_once_and_in_sequence()
    {
        var store = new TransactionStore(1000);
        var broadcaster = new RecordingBroadcaster();
        using var processor = new TransactionProcessor(store, broadcaster, NullLogger<TransactionProcessor>.Instance);
        await Task.WhenAll(Enumerable.Range(0, 100).Select(_ => processor.ProcessAsync(Input())));
        Assert.Equal(Enumerable.Range(1, 100).Select(x => (long)x), broadcaster.Items.Select(x => x.Sequence));
        var duplicate = Input();
        await processor.ProcessAsync(duplicate);
        await processor.ProcessAsync(duplicate);
        Assert.Equal(101, broadcaster.Items.Count);
        Assert.Equal(101, store.Snapshot().Transactions.Count);
    }

    [Fact]
    public async Task Broadcast_failure_does_not_undo_accepted_storage()
    {
        var store = new TransactionStore(10);
        using var processor = new TransactionProcessor(store, new BrokenBroadcaster(), NullLogger<TransactionProcessor>.Instance);
        await processor.ProcessAsync(Input());
        Assert.Single(store.Snapshot().Transactions);
    }

    private sealed class RecordingBroadcaster : ITransactionBroadcaster
    {
        public List<TransactionRecord> Items { get; } = [];
        public async Task BroadcastAsync(TransactionRecord transaction, CancellationToken cancellationToken)
        {
            await Task.Yield();
            Items.Add(transaction);
        }
    }
    private sealed class BrokenBroadcaster : ITransactionBroadcaster
    {
        public Task BroadcastAsync(TransactionRecord transaction, CancellationToken cancellationToken) => throw new IOException("offline");
    }
}
