using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using StackExchange.Redis;

namespace FinancialMonitor.Api;

// Lua keeps writes atomic across pods; the hash tag keeps keys in one cluster slot.
public sealed class RedisTransactionStore(IConnectionMultiplexer connection, int capacity, string keyPrefix) : ITransactionStore
{
    private readonly IDatabase database = connection.GetDatabase();
    private readonly RedisKey[] keys = [$"{{{keyPrefix}}}:records", $"{{{keyPrefix}}}:order", $"{{{keyPrefix}}}:sequence", $"{{{keyPrefix}}}:capacity"];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.AllowReadingFromString };

    private const string UpsertScript = """
        local configured = redis.call('GET', KEYS[4])
        if configured and configured ~= ARGV[7] then return redis.error_reply('Store capacity differs between replicas') end
        local raw = redis.call('HGET', KEYS[1], ARGV[1])
        local old = raw and cjson.decode(raw)
        local amount, currency, status, timestamp = ARGV[2], ARGV[3], ARGV[4], ARGV[5]
        if ARGV[6] == 'status' then
            if not raw then return {-2} end
            if old.status == status then return {0, raw} end
            if old.status ~= 'Pending' then return {-1} end
            amount, currency = old.amount, old.currency
            if timestamp < old.timestamp then timestamp = old.timestamp end
        elseif raw then
            if old.amount == amount and old.currency == currency and old.status == status and old.timestamp == timestamp then return {0, raw} end
            if old.amount ~= amount or old.currency ~= currency or old.status ~= 'Pending' or (status ~= 'Completed' and status ~= 'Failed') or timestamp < old.timestamp then return {-1} end
        end
        if status ~= 'Pending' and status ~= 'Completed' and status ~= 'Failed' then return {-1} end
        redis.call('SET', KEYS[4], ARGV[7], 'NX')
        local sequence = redis.call('INCR', KEYS[3])
        local activity = {kind=raw and 'StatusChanged' or 'Created', occurredAt=ARGV[8]}
        if old then activity.previousStatus = old.status end
        local record = cjson.encode({transactionId=ARGV[1], amount=amount, currency=currency, status=status, timestamp=timestamp, sequence=sequence, activity=activity})
        redis.call('HSET', KEYS[1], ARGV[1], record)
        redis.call('ZADD', KEYS[2], sequence, ARGV[1])
        local excess = redis.call('ZCARD', KEYS[2]) - tonumber(ARGV[7])
        if excess > 0 then
            local evicted = redis.call('ZRANGE', KEYS[2], 0, excess - 1)
            for _, id in ipairs(evicted) do
                redis.call('HDEL', KEYS[1], id)
                redis.call('ZREM', KEYS[2], id)
            end
        end
        return {1, record}
        """;

    private const string SnapshotScript = """
        local configured = redis.call('GET', KEYS[4])
        if configured and configured ~= ARGV[1] then return redis.error_reply('Store capacity differs between replicas') end
        local ids = redis.call('ZREVRANGE', KEYS[2], 0, -1)
        local records = {}
        for _, id in ipairs(ids) do table.insert(records, redis.call('HGET', KEYS[1], id)) end
        return {redis.call('GET', KEYS[3]) or '0', records}
        """;

    public Task<UpsertResult> UpsertAsync(TransactionInput input) => ExecuteAsync(input, "upsert");
    public Task<UpsertResult> UpdateStatusAsync(Guid id, string status)
    {
        if (status is not ("Completed" or "Failed")) throw new TransactionConflictException("Choose a terminal status to resolve a Pending transaction.");
        return ExecuteAsync(new(id, 0m, "", status, DateTimeOffset.UtcNow), "status");
    }

    private async Task<UpsertResult> ExecuteAsync(TransactionInput input, string operation)
    {
        var result = (RedisResult[])(await database.ScriptEvaluateAsync(UpsertScript, keys,
            [input.TransactionId.ToString(), input.Amount.ToString("0.00", CultureInfo.InvariantCulture), input.Currency!, input.Status!,
                input.Timestamp.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture), operation,
                capacity.ToString(CultureInfo.InvariantCulture),
                DateTimeOffset.UtcNow.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture)]))!;
        var code = (int)result[0];
        if (code == -2) throw new TransactionNotFoundException();
        if (code == -1) throw new TransactionConflictException("Only Pending -> Completed/Failed is allowed, with unchanged amount/currency and a non-decreasing timestamp.");
        return new(Deserialize((string)result[1]!), code == 1);
    }

    public async Task<TransactionSnapshot> SnapshotAsync()
    {
        var result = (RedisResult[])(await database.ScriptEvaluateAsync(SnapshotScript, keys,
            [capacity.ToString(CultureInfo.InvariantCulture)]))!;
        var values = (RedisResult[])result[1]!;
        return new(values.Select(value => Deserialize((string)value!)).ToArray(), (long)result[0], capacity);
    }

    public async Task<TransactionRecord?> GetAsync(Guid id)
    {
        var raw = await database.HashGetAsync(keys[0], id.ToString());
        return raw.IsNull ? null : Deserialize(raw.ToString());
    }

    private static TransactionRecord Deserialize(string raw) => JsonSerializer.Deserialize<TransactionRecord>(raw, Json)!;
}
