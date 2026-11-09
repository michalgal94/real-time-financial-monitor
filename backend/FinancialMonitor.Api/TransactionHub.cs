using Microsoft.AspNetCore.SignalR;

namespace FinancialMonitor.Api;

public sealed class TransactionHub(ITransactionStore store) : Hub
{
    public Task<TransactionSnapshot> GetSnapshot() => store.SnapshotAsync();
}

public sealed class SignalRTransactionBroadcaster(IHubContext<TransactionHub> hub) : ITransactionBroadcaster
{
    public Task BroadcastAsync(TransactionRecord transaction, CancellationToken cancellationToken) =>
        hub.Clients.All.SendAsync("TransactionUpdated", transaction, cancellationToken);
}
