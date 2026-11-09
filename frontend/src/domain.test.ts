import { describe, expect, it } from "vitest";
import {
  mergeTransactions,
  reconcileSnapshot,
  matchesTransactionSearch,
  matchesTransactionDateRange,
  formatActivityAge,
  type Transaction,
} from "./domain";

const item = (
  id: string,
  sequence: number,
  status: Transaction["status"] = "Pending",
): Transaction => ({
  transactionId: id,
  sequence,
  status,
  amount: 10,
  currency: "USD",
  timestamp: "2026-11-07T10:00:00Z",
});

describe("transaction date range", () => {
  const at = (day: number, hour = 12, minute = 0, second = 0, ms = 0) => ({
    ...item("date-range", 1),
    timestamp: new Date(2032, 0, day, hour, minute, second, ms).toISOString(),
  });

  it.each([
    [at(14, 23, 59, 59, 999), false],
    [at(15, 0), true],
    [at(15, 12), true],
    [at(16, 12), true],
    [at(16, 23, 59, 59, 999), true],
    [at(17, 0), false],
  ])("includes both local calendar days for %j", (transaction, expected) => {
    expect(
      matchesTransactionDateRange(transaction, "2032-01-15", "2032-01-16"),
    ).toBe(expected);
  });

  it.each([
    [at(14), "2032-01-15", "", false],
    [at(16), "2032-01-15", "", true],
    [at(14), "", "2032-01-15", true],
    [at(16), "", "2032-01-15", false],
  ])("supports an open-ended range for %j", (transaction, from, to, expected) => {
    expect(matchesTransactionDateRange(transaction, from, to)).toBe(expected);
  });

  it("leaves transactions unchanged when neither date is set", () => {
    expect(matchesTransactionDateRange(at(15), "", "")).toBe(true);
  });

  it("does not match a reversed range", () => {
    expect(
      matchesTransactionDateRange(at(15), "2032-01-16", "2032-01-14"),
    ).toBe(false);
  });

  it("excludes invalid transaction timestamps when a date is selected", () => {
    expect(
      matchesTransactionDateRange(
        { ...at(15), timestamp: "invalid" },
        "2032-01-15",
        "",
      ),
    ).toBe(false);
  });
});

describe("activity age", () => {
  const timestamp = "2026-11-08T10:00:00Z";
  const instant = Date.parse(timestamp);
  it.each([
    [-1000, "just now"],
    [0, "just now"],
    [59000, "just now"],
    [60000, "1 min ago"],
    [120000, "2 min ago"],
    [3599000, "59 min ago"],
    [3600000, "1 hr ago"],
    [86400000, "1 day ago"],
    [172800000, "2 days ago"],
  ])("formats elapsed time %i without negative ages", (elapsed, expected) => {
    expect(formatActivityAge(timestamp, instant + elapsed)).toBe(expected);
  });
});

describe("transaction search", () => {
  const transaction = {
    ...item("531d563b-6088-4d9e-8b2a-83beb63d5e15", 1),
    amount: 1500.5,
  };
  it.each([
    "1500.50",
    "1,500.50",
    "$1,500.50",
    "  1,500.50  ",
    "1500.5",
    "1500",
    "usd",
    "531D563B",
    "",
  ])("finds the transaction using %j", (query) =>
    expect(matchesTransactionSearch(transaction, query)).toBe(true),
  );
  it.each(["2500.50", "1,500.51", "EUR", "$2,000.00"])(
    "does not match unrelated input %j",
    (query) => expect(matchesTransactionSearch(transaction, query)).toBe(false),
  );
  it("preserves the displayed trailing zeros of whole amounts", () => {
    expect(
      matchesTransactionSearch({ ...transaction, amount: 1500 }, "1,500.00"),
    ).toBe(true);
  });
  it("supports amounts below one unit", () => {
    expect(
      matchesTransactionSearch({ ...transaction, amount: 0.08 }, "$0.08"),
    ).toBe(true);
  });
  it.each([
    ["EUR", "€1,500.50"],
    ["ILS", "₪1,500.50"],
    ["USD", "USD 1,500.50"],
  ])("supports the displayed %s currency", (currency, query) =>
    expect(matchesTransactionSearch({ ...transaction, currency }, query)).toBe(
      true,
    ),
  );
});

describe("transaction reconciliation", () => {
  it("deduplicates retries, ignores out-of-order events and applies newer statuses", () => {
    const result = mergeTransactions(
      [item("a", 3, "Completed")],
      [item("a", 2), item("b", 4), item("b", 4)],
    );
    expect(result).toEqual([item("b", 4), item("a", 3, "Completed")]);
  });
  it("bounds a burst to the latest records by ingestion sequence", () => {
    const result = mergeTransactions(
      [],
      Array.from({ length: 2000 }, (_, i) => item(String(i), i)),
      1000,
    );
    expect(result).toHaveLength(1000);
    expect(result[0].sequence).toBe(1999);
    expect(result[999].sequence).toBe(1000);
  });
  it("preserves updates arriving during the initial snapshot request", () => {
    expect(
      reconcileSnapshot(
        { transactions: [item("a", 5)], watermark: 5, capacity: 10 },
        [item("a", 4), item("a", 6, "Completed"), item("b", 7)],
      ),
    ).toEqual([item("b", 7), item("a", 6, "Completed")]);
  });
  it("replaces stale state after a server restart or eviction", () => {
    expect(
      reconcileSnapshot(
        { transactions: [item("new", 1)], watermark: 1, capacity: 10 },
        [],
      ),
    ).toEqual([item("new", 1)]);
  });
});

describe("timestamp search", () => {
  const timestamp = "2026-11-08T10:20:30.0000000+00:00";
  const transaction = {
    ...item("531d563b-6088-4d9e-8b2a-83beb63d5e15", 1),
    timestamp,
  };
  const date = new Date(timestamp);
  const localTime = date.toLocaleTimeString("en-GB");
  const localDate = date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const numericDate = date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  it.each([
    "2026-11-08",
    "2026-11",
    "2026-11-08T10:20:30Z",
    "2026-11-08T10:20:30.000Z",
    timestamp,
    localTime,
    localTime.slice(0, 5),
    localDate,
    numericDate,
    `${localDate} ${localTime}`,
    `${numericDate} ${localTime}`,
  ])("finds timestamp text %j", (query) =>
    expect(matchesTransactionSearch(transaction, query)).toBe(true),
  );
  it.each(["2077-12-31", "31/12/2077", "23:59:59"])(
    "rejects unrelated timestamp text %j",
    (query) => expect(matchesTransactionSearch(transaction, query)).toBe(false),
  );
});
