using Microsoft.AspNetCore.Diagnostics;
using StackExchange.Redis;

namespace FinancialMonitor.Api;

public sealed class RedisExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not RedisException) return false;
        await Results.Problem(statusCode: 503, title: "Shared storage unavailable",
            detail: "The shared transaction service is temporarily unavailable. Retry the same request when it recovers.").ExecuteAsync(context);
        return true;
    }
}
