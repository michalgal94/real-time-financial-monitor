using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace FinancialMonitor.Api;

public sealed class StoreHealthCheck(ITransactionStore store) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await store.SnapshotAsync().WaitAsync(cancellationToken);
            return HealthCheckResult.Healthy();
        }
        catch (Exception exception) { return HealthCheckResult.Unhealthy("Transaction storage is unavailable.", exception); }
    }
}
