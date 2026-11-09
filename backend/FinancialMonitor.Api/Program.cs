using FinancialMonitor.Api;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<RedisExceptionHandler>();
builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(options => options.ThrowOnBadRequest = false);
var signalR = builder.Services.AddSignalR(options => options.MaximumReceiveMessageSize = 16 * 1024);
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = 16 * 1024);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 16 * 1024);
var capacity = builder.Configuration.GetValue("Transactions:Capacity", 1000);
if (capacity < 1) throw new InvalidOperationException("Transactions:Capacity must be positive.");
var provider = builder.Configuration.GetValue("Storage:Provider", "Memory");
if (provider == "Redis")
{
    var redisConnection = builder.Configuration.GetConnectionString("Redis")
        ?? throw new InvalidOperationException("ConnectionStrings:Redis is required for Redis storage.");
    var prefix = builder.Configuration.GetValue("Redis:KeyPrefix", "ledger")!;
    if (string.IsNullOrWhiteSpace(prefix) || prefix.Contains('{') || prefix.Contains('}'))
        throw new InvalidOperationException("Redis:KeyPrefix must be non-empty and must not contain braces.");
    builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    {
        var configuration = ConfigurationOptions.Parse(redisConnection);
        configuration.AbortOnConnectFail = false;
        return ConnectionMultiplexer.Connect(configuration);
    });
    builder.Services.AddSingleton<ITransactionStore>(services => new RedisTransactionStore(
        services.GetRequiredService<IConnectionMultiplexer>(), capacity, prefix));
    signalR.AddStackExchangeRedis(redisConnection, options =>
    {
        options.Configuration.ChannelPrefix = RedisChannel.Literal(prefix);
        options.Configuration.AbortOnConnectFail = false;
    });
}
else if (provider == "Memory") builder.Services.AddSingleton<ITransactionStore>(new TransactionStore(capacity));
else throw new InvalidOperationException("Storage:Provider must be Memory or Redis.");
builder.Services.AddSingleton<ITransactionBroadcaster, SignalRTransactionBroadcaster>();
builder.Services.AddSingleton<TransactionProcessor>();
builder.Services.AddHealthChecks().AddCheck<StoreHealthCheck>("storage");

var app = builder.Build();
app.UseExceptionHandler();
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "same-origin";
    await next(context);
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready");
app.MapGet("/api/transactions", async (ITransactionStore store) => Results.Ok(await store.SnapshotAsync()));
app.MapPost("/api/transactions", async (TransactionInput input, TransactionProcessor processor, CancellationToken cancellationToken) =>
{
    var errors = TransactionValidator.Validate(input);
    if (errors.Count > 0) return Results.ValidationProblem(errors);
    try
    {
        var result = await processor.ProcessAsync(input, cancellationToken);
        return result.Changed
            ? Results.Created($"/api/transactions/{result.Transaction.TransactionId}", result.Transaction)
            : Results.Ok(result.Transaction);
    }
    catch (TransactionConflictException exception)
    {
        return Results.Problem(statusCode: 409, title: "Transaction conflict", detail: exception.Message);
    }
});
app.MapPatch("/api/transactions/{id:guid}/status", async (Guid id, StatusUpdate update, TransactionProcessor processor, CancellationToken cancellationToken) =>
{
    if (update.Status is not ("Completed" or "Failed"))
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["Choose Completed or Failed to resolve an existing Pending transaction."] });
    try { return Results.Ok((await processor.UpdateStatusAsync(id, update.Status, cancellationToken)).Transaction); }
    catch (TransactionNotFoundException) { return Results.NotFound(); }
    catch (TransactionConflictException exception) { return Results.Problem(statusCode: 409, title: "Transaction conflict", detail: exception.Message); }
});
app.MapGet("/api/transactions/{id:guid}", async (Guid id, ITransactionStore store) =>
    await store.GetAsync(id) is { } transaction ? Results.Ok(transaction) : Results.NotFound());
app.MapHub<TransactionHub>("/hubs/transactions");
app.Map("/api/{**path}", () => Results.NotFound());
app.Map("/hubs/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html");
app.Run();

public partial class Program;
