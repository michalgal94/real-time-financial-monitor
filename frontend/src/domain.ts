export type Status = "Pending" | "Completed" | "Failed";
export interface TransactionInput {
  transactionId: string;
  amount: number;
  currency: string;
  status: Status;
  timestamp: string;
}
export interface Transaction extends TransactionInput {
  sequence: number;
  activity?: {
    kind: "Created" | "StatusChanged";
    occurredAt: string;
    previousStatus?: Status | null;
  } | null;
}
export interface Snapshot {
  transactions: Transaction[];
  watermark: number;
  capacity: number;
}
export const MAX_RECORDS = 1000;
export interface TransactionHighlight {
  kind: "new" | "updated";
  sequence: number;
  previousStatus?: Status;
  expiresAt: number;
}

export function formatActivityAge(timestamp: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(timestamp));
  if (!Number.isFinite(elapsed)) return "Time unavailable";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function matchesTransactionSearch(
  transaction: Transaction,
  query: string,
): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s,\u200e\u200f\u061c]/g, "");
  const search = normalize(query);
  if (!search) return true;
  const amount = transaction.amount.toFixed(2);
  if (
    [
      transaction.transactionId,
      `${transaction.currency} ${amount}`,
      `${amount} ${transaction.currency}`,
      formatAmount(transaction.amount, transaction.currency),
    ].some((value) => normalize(value).includes(search))
  )
    return true;

  const instant = new Date(transaction.timestamp);
  if (Number.isNaN(instant.getTime()))
    return normalize(transaction.timestamp).includes(search);
  const iso = instant.toISOString();
  const display = formatTimestamp(transaction.timestamp);
  return [
    transaction.timestamp,
    iso,
    iso.replace(/\.000Z$/, "Z"),
    display.date,
    display.numericDate,
    display.localIsoDate,
    display.time,
    `${display.date} ${display.time}`,
    `${display.numericDate} ${display.time}`,
    `${display.localIsoDate}T${display.time}`,
    `${display.localIsoDate} ${display.time}`,
  ].some((value) => normalize(value).includes(search));
}

export function matchesTransactionDateRange(
  transaction: Transaction,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true;
  const instant = new Date(transaction.timestamp);
  if (Number.isNaN(instant.getTime())) return false;
  const day = localCalendarDate(instant);
  return (!from || day >= from) && (!to || day <= to);
}

function localCalendarDate(instant: Date): string {
  const year = String(instant.getFullYear()).padStart(4, "0");
  const month = String(instant.getMonth() + 1).padStart(2, "0");
  const day = String(instant.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const timestampDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const timestampTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const timestampNumericDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatTimestamp(timestamp: string) {
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime()))
    return {
      date: "Invalid date",
      time: "Invalid date",
      numericDate: "",
      localIsoDate: "",
    };
  return {
    date: timestampDateFormatter.format(instant),
    time: timestampTimeFormatter.format(instant),
    numericDate: timestampNumericDateFormatter.format(instant),
    localIsoDate: localCalendarDate(instant),
  };
}

export function mergeTransactions(
  current: Transaction[],
  incoming: Transaction[],
  capacity = MAX_RECORDS,
): Transaction[] {
  const byId = new Map(current.map((item) => [item.transactionId, item]));
  for (const item of incoming) {
    const previous = byId.get(item.transactionId);
    if (!previous || item.sequence > previous.sequence)
      byId.set(item.transactionId, item);
  }
  return [...byId.values()]
    .sort((a, b) => b.sequence - a.sequence)
    .slice(0, capacity);
}

export function reconcileSnapshot(
  snapshot: Snapshot,
  buffered: Transaction[],
): Transaction[] {
  return mergeTransactions(
    snapshot.transactions,
    buffered.filter((item) => item.sequence > snapshot.watermark),
    snapshot.capacity,
  );
}

export function generateTransaction(): TransactionInput {
  const statuses: Status[] = [
    "Completed",
    "Completed",
    "Completed",
    "Pending",
    "Failed",
  ];
  return {
    transactionId: crypto.randomUUID(),
    amount: (Math.floor(Math.random() * 250000) + 1) / 100,
    currency: ["USD", "EUR", "GBP"][Math.floor(Math.random() * 3)],
    status: statuses[Math.floor(Math.random() * statuses.length)],
    timestamp: new Date().toISOString(),
  };
}

export async function postTransaction(
  transaction: TransactionInput,
): Promise<Transaction> {
  const response = await fetch("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(transaction),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      detail?: string;
      errors?: Record<string, string[]>;
    } | null;
    throw new Error(
      problem?.detail ??
        (problem?.errors
          ? Object.values(problem.errors).flat().join(" ")
          : `Request failed (${response.status}).`),
    );
  }
  return response.json() as Promise<Transaction>;
}

export async function updateTransactionStatus(
  id: string,
  status: "Completed" | "Failed",
): Promise<Transaction> {
  const response = await fetch(
    `/api/transactions/${encodeURIComponent(id)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(
      problem?.detail ??
        (response.status === 404
          ? "This transaction is no longer in the retained window."
          : `Could not update transaction (${response.status}).`),
    );
  }
  return response.json() as Promise<Transaction>;
}

const amountFormatters = new Map<string, Intl.NumberFormat>();

export const formatAmount = (amount: number, currency: string) => {
  try {
    let formatter = amountFormatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
      });
      amountFormatters.set(currency, formatter);
    }
    return formatter.format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};
