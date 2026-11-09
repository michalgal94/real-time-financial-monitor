using System.Text.RegularExpressions;

namespace FinancialMonitor.Api;

public sealed record TransactionInput(Guid TransactionId, decimal Amount, string? Currency, string? Status, DateTimeOffset Timestamp);
public sealed record TransactionActivity(string Kind, DateTimeOffset OccurredAt, string? PreviousStatus = null);
public sealed record TransactionRecord(Guid TransactionId, decimal Amount, string Currency, string Status, DateTimeOffset Timestamp, long Sequence, TransactionActivity? Activity = null);
public sealed record TransactionSnapshot(IReadOnlyList<TransactionRecord> Transactions, long Watermark, int Capacity);
public sealed record UpsertResult(TransactionRecord Transaction, bool Changed);
public sealed class TransactionConflictException(string message) : Exception(message);
public sealed class TransactionNotFoundException : Exception;
public sealed record StatusUpdate(string? Status);

public interface ITransactionStore
{
    Task<UpsertResult> UpsertAsync(TransactionInput input);
    Task<UpsertResult> UpdateStatusAsync(Guid id, string status);
    Task<TransactionSnapshot> SnapshotAsync();
    Task<TransactionRecord?> GetAsync(Guid id);
}

public static partial class TransactionValidator
{
    [GeneratedRegex("^[A-Z]{3}$", RegexOptions.CultureInvariant)]
    private static partial Regex CurrencyPattern();
    public static Dictionary<string, string[]> Validate(TransactionInput input)
    {
        var errors = new Dictionary<string, string[]>();
        if (input.TransactionId == Guid.Empty) errors["transactionId"] = ["A non-empty UUID is required."];
        if (input.Amount <= 0 || input.Amount > 1_000_000_000m || decimal.Round(input.Amount, 2) != input.Amount)
            errors["amount"] = ["Amount must be positive, at most 1,000,000,000, with at most two decimal places."];
        if (input.Currency is null || !CurrencyPattern().IsMatch(input.Currency)) errors["currency"] = ["Use a three-letter uppercase currency code, e.g. USD."];
        if (input.Status is not ("Pending" or "Completed" or "Failed")) errors["status"] = ["Status must be Pending, Completed or Failed."];
        if (input.Timestamp == default) errors["timestamp"] = ["A valid ISO-8601 timestamp is required."];
        return errors;
    }
}

// Keep lookup, transition, sequence allocation and eviction inside the same lock.
public sealed class TransactionStore : ITransactionStore
{
    private readonly object gate = new();
    private readonly Dictionary<Guid, TransactionRecord> records = [];
    private readonly int capacity;
    private long sequence;

    public TransactionStore(int capacity = 1000)
    {
        if (capacity < 1) throw new ArgumentOutOfRangeException(nameof(capacity));
        this.capacity = capacity;
    }

    public UpsertResult Upsert(TransactionInput input)
    {
        lock (gate)
        {
            if (records.TryGetValue(input.TransactionId, out var previous))
            {
                if (previous.Amount == input.Amount && previous.Currency == input.Currency && previous.Status == input.Status && previous.Timestamp == input.Timestamp)
                    return new(previous, false);
                if (previous.Amount != input.Amount || previous.Currency != input.Currency ||
                    previous.Status != "Pending" || input.Status is not ("Completed" or "Failed") || input.Timestamp < previous.Timestamp)
                    throw new TransactionConflictException("Only Pending → Completed/Failed is allowed, with unchanged amount/currency and a non-decreasing timestamp.");
            }
            var activity = new TransactionActivity(previous is null ? "Created" : "StatusChanged", DateTimeOffset.UtcNow, previous?.Status);
            var record = new TransactionRecord(input.TransactionId, input.Amount, input.Currency!, input.Status!, input.Timestamp.ToUniversalTime(), ++sequence, activity);
            records[input.TransactionId] = record;
            if (records.Count > capacity) records.Remove(records.MinBy(x => x.Value.Sequence).Key);
            return new(record, true);
        }
    }

    public TransactionSnapshot Snapshot()
    {
        lock (gate) return new(records.Values.OrderByDescending(x => x.Sequence).ToArray(), sequence, capacity);
    }

    public Task<UpsertResult> UpsertAsync(TransactionInput input) => Task.FromResult(Upsert(input));
    public Task<TransactionSnapshot> SnapshotAsync() => Task.FromResult(Snapshot());
    public Task<TransactionRecord?> GetAsync(Guid id)
    {
        lock (gate) return Task.FromResult(records.GetValueOrDefault(id));
    }
    public Task<UpsertResult> UpdateStatusAsync(Guid id, string status)
    {
        if (status is not ("Completed" or "Failed")) throw new TransactionConflictException("Choose a terminal status to resolve a Pending transaction.");
        lock (gate)
        {
            if (!records.TryGetValue(id, out var previous)) throw new TransactionNotFoundException();
            if (previous.Status == status) return Task.FromResult(new UpsertResult(previous, false));
            var now = DateTimeOffset.UtcNow;
            return Task.FromResult(Upsert(new(id, previous.Amount, previous.Currency, status,
                now > previous.Timestamp ? now : previous.Timestamp)));
        }
    }
}

public interface ITransactionBroadcaster
{
    Task BroadcastAsync(TransactionRecord transaction, CancellationToken cancellationToken);
}

public sealed class TransactionProcessor(ITransactionStore store, ITransactionBroadcaster broadcaster, ILogger<TransactionProcessor> logger) : IDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public Task<UpsertResult> ProcessAsync(TransactionInput input, CancellationToken cancellationToken = default) =>
        CommitAsync(() => store.UpsertAsync(input), cancellationToken);

    public Task<UpsertResult> UpdateStatusAsync(Guid id, string status, CancellationToken cancellationToken = default) =>
        CommitAsync(() => store.UpdateStatusAsync(id, status), cancellationToken);

    private async Task<UpsertResult> CommitAsync(Func<Task<UpsertResult>> commit, CancellationToken cancellationToken)
    {
        // After saving, finish broadcasting even if the HTTP client disconnects.
        await gate.WaitAsync(cancellationToken);
        try
        {
            var result = await commit();
            if (result.Changed)
            {
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                    await broadcaster.BroadcastAsync(result.Transaction, timeout.Token);
                }
                catch (Exception exception)
                {
                    // The write succeeded; snapshots recover a missed broadcast.
                    logger.LogWarning(exception, "Broadcast failed for sequence {Sequence}", result.Transaction.Sequence);
                }
            }
            return result;
        }
        finally { gate.Release(); }
    }

    public void Dispose() => gate.Dispose();
}
