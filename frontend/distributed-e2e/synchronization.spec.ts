import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  HubConnectionBuilder,
  HttpTransportType,
  LogLevel,
} from "@microsoft/signalr";
import type { Snapshot, Transaction } from "../src/domain";

test("a write to replica B reaches browsers connected to A and B before snapshot recovery", async ({
  context,
  request,
}) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await Promise.all([
    a.goto("http://127.0.0.1:5183/monitor"),
    b.goto("http://127.0.0.1:5184/monitor"),
  ]);
  for (const page of [a, b])
    await expect(
      page.getByText("Live connection", { exact: true }),
    ).toBeVisible();
  const input = {
    transactionId: randomUUID(),
    amount: 127.83,
    currency: "USD",
    status: "Pending",
    timestamp: new Date().toISOString(),
  };
  expect(
    (
      await request.post("http://127.0.0.1:5091/api/transactions", {
        data: input,
      })
    ).status(),
  ).toBe(201);
  for (const page of [a, b]) {
    const row = page
      .locator("tbody tr")
      .filter({ hasText: input.transactionId.slice(0, 8) });
    await expect(row.getByText("Pending", { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(row.getByText("NEW", { exact: true })).toBeVisible();
  }
  const snapshotA = await (
    await request.get("http://127.0.0.1:5090/api/transactions")
  ).json();
  const snapshotB = await (
    await request.get("http://127.0.0.1:5091/api/transactions")
  ).json();
  expect(snapshotA).toEqual(snapshotB);
  expect(
    (
      await request.patch(
        `http://127.0.0.1:5090/api/transactions/${input.transactionId}/status`,
        { data: { status: "Completed" } },
      )
    ).status(),
  ).toBe(200);
  for (const page of [a, b]) {
    const row = page
      .locator("tbody tr")
      .filter({ hasText: input.transactionId.slice(0, 8) });
    await expect(row.getByText("Completed", { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(row).toHaveClass(/highlight-updated/);
  }
  await a.screenshot({
    path: "../docs/screenshots/distributed-monitor.png",
    fullPage: true,
  });
});

test("duplicate POSTs and conflicting terminal updates remain atomic across independent backend processes", async ({
  request,
}) => {
  const input = {
    transactionId: randomUUID(),
    amount: 10.25,
    currency: "EUR",
    status: "Pending",
    timestamp: new Date().toISOString(),
  };
  const duplicates = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      request.post(`http://127.0.0.1:${i % 2 ? 5090 : 5091}/api/transactions`, {
        data: input,
      }),
    ),
  );
  expect(
    duplicates.filter((response) => response.status() === 201),
  ).toHaveLength(1);
  expect(
    duplicates.filter((response) => response.status() === 200),
  ).toHaveLength(29);
  const resolutions = await Promise.all([
    request.patch(
      `http://127.0.0.1:5090/api/transactions/${input.transactionId}/status`,
      { data: { status: "Completed" } },
    ),
    request.patch(
      `http://127.0.0.1:5091/api/transactions/${input.transactionId}/status`,
      { data: { status: "Failed" } },
    ),
  ]);
  expect(resolutions.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ]);
  const a = await (
    await request.get(
      `http://127.0.0.1:5090/api/transactions/${input.transactionId}`,
    )
  ).json();
  const b = await (
    await request.get(
      `http://127.0.0.1:5091/api/transactions/${input.transactionId}`,
    )
  ).json();
  expect(a).toEqual(b);
  expect(["Completed", "Failed"]).toContain(a.status);
});

test("five replicas broadcast without polling and agree under concurrent ingestion and resolutions", async ({
  request,
}) => {
  const urls = Array.from(
    { length: 5 },
    (_, index) => `http://127.0.0.1:${5090 + index}`,
  );
  const received = urls.map(() => new Map<string, Transaction>());
  const connections = urls.map((url, index) => {
    const connection = new HubConnectionBuilder()
      .withUrl(`${url}/hubs/transactions`, {
        transport: HttpTransportType.WebSockets,
        skipNegotiation: true,
      })
      .configureLogging(LogLevel.Warning)
      .build();
    connection.on("TransactionUpdated", (transaction: Transaction) => {
      const previous = received[index].get(transaction.transactionId);
      if (!previous || transaction.sequence > previous.sequence)
        received[index].set(transaction.transactionId, transaction);
    });
    return connection;
  });

  try {
    await Promise.all(connections.map((connection) => connection.start()));
    await Promise.all(
      connections.map((connection) =>
        connection.invoke<Snapshot>("GetSnapshot"),
      ),
    );
    const input = {
      transactionId: randomUUID(),
      amount: 1500.5,
      currency: "USD",
      status: "Pending",
      timestamp: new Date().toISOString(),
    };
    const response = await request.post(`${urls[4]}/api/transactions`, {
      data: input,
    });
    expect(response.status()).toBe(201);
    const created: Transaction = await response.json();
    // The receive maps are populated only by live events, never by snapshot polling.
    await expect
      .poll(
        () =>
          received.every(
            (items) =>
              items.get(input.transactionId)?.sequence === created.sequence,
          ),
        { timeout: 5000 },
      )
      .toBe(true);

    const burst = Array.from({ length: 100 }, () => ({
      ...input,
      transactionId: randomUUID(),
    }));
    const accepted = await Promise.all(
      burst.map((transaction, index) =>
        request.post(`${urls[index % 5]}/api/transactions`, {
          data: transaction,
        }),
      ),
    );
    expect(accepted.every((item) => item.status() === 201)).toBe(true);
    const records: Transaction[] = await Promise.all(
      accepted.map((item) => item.json()),
    );
    expect(new Set(records.map((item) => item.sequence)).size).toBe(100);
    await expect
      .poll(
        () =>
          received.every((items) =>
            burst.every((transaction) => items.has(transaction.transactionId)),
          ),
        { timeout: 5000 },
      )
      .toBe(true);

    const before: Snapshot = await (
      await request.get(`${urls[0]}/api/transactions`)
    ).json();
    const resolutions = await Promise.all(
      urls.map((url, index) =>
        request.patch(`${url}/api/transactions/${input.transactionId}/status`, {
          data: { status: index % 2 === 0 ? "Completed" : "Failed" },
        }),
      ),
    );
    expect(
      resolutions.every((item) => [200, 409].includes(item.status())),
    ).toBe(true);
    const winners: Transaction[] = await Promise.all(
      resolutions
        .filter((item) => item.status() === 200)
        .map((item) => item.json()),
    );
    expect(winners.length).toBeGreaterThan(0);
    expect(new Set(winners.map((item) => item.status)).size).toBe(1);
    expect(new Set(winners.map((item) => item.sequence)).size).toBe(1);
    expect(winners[0].sequence).toBe(before.watermark + 1);
    await expect
      .poll(
        () =>
          received.every(
            (items) =>
              items.get(input.transactionId)?.sequence === winners[0].sequence,
          ),
        { timeout: 5000 },
      )
      .toBe(true);

    const snapshots = await Promise.all(
      connections.map((connection) =>
        connection.invoke<Snapshot>("GetSnapshot"),
      ),
    );
    for (const snapshot of snapshots) expect(snapshot).toEqual(snapshots[0]);
    expect(snapshots[0].watermark).toBe(before.watermark + 1);
    expect(
      snapshots[0].transactions.find(
        (item) => item.transactionId === input.transactionId,
      )?.activity?.previousStatus,
    ).toBe("Pending");
  } finally {
    await Promise.allSettled(
      connections.map((connection) => connection.stop()),
    );
  }
});
