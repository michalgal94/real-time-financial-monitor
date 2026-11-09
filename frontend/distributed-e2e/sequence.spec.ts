import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("a single status action sends one PATCH and consumes one global event across replicas", async ({
  context,
  request,
}) => {
  const monitor = await context.newPage();
  const simulator = await context.newPage();
  await monitor.goto("http://127.0.0.1:5183/monitor");
  await simulator.goto("http://127.0.0.1:5184/add");
  await expect(
    monitor.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  await expect(
    monitor.getByRole("columnheader", { name: "Row number", exact: true }),
  ).toBeVisible();

  for (const status of ["Completed", "Failed"] as const) {
    const input = {
      transactionId: randomUUID(),
      amount: 19.25,
      currency: "USD",
      status: "Pending",
      timestamp: new Date().toISOString(),
    };
    const created = await (
      await request.post("http://127.0.0.1:5090/api/transactions", {
        data: input,
      })
    ).json();
    // An unrelated transaction takes the next global event number.
    await request.post("http://127.0.0.1:5091/api/transactions", {
      data: { ...input, transactionId: randomUUID() },
    });
    const before = await (
      await request.get("http://127.0.0.1:5090/api/transactions")
    ).json();
    const row = monitor
      .locator("tbody tr")
      .filter({ hasText: input.transactionId.slice(0, 8) });
    await expect(row.locator(".row-number")).toHaveText("2");
    const requests: string[] = [];
    const record = (message: import("@playwright/test").Request) => {
      if (
        message.url().includes("/api/transactions") &&
        ["POST", "PATCH"].includes(message.method())
      )
        requests.push(message.method());
    };
    simulator.on("request", record);
    try {
      await simulator
        .locator("#pending tbody tr")
        .filter({ hasText: input.transactionId.slice(0, 8) })
        .getByRole("button", {
          name: status === "Completed" ? "Complete" : "Mark failed",
          exact: true,
        })
        .click();
      await expect(row.getByText(status, { exact: true })).toBeVisible();
      const after = await (
        await request.get("http://127.0.0.1:5090/api/transactions")
      ).json();
      expect(requests).toEqual(["PATCH"]);
      expect(after.watermark).toBe(before.watermark + 1);
      expect(after.transactions).toHaveLength(before.transactions.length);
      await expect(row.locator(".row-number")).toHaveText("1");
      expect(
        after.transactions.find(
          (item: { transactionId: string }) =>
            item.transactionId === input.transactionId,
        ).sequence,
      ).toBe(created.sequence + 2);
      expect(
        after.transactions.find(
          (item: { transactionId: string }) =>
            item.transactionId === input.transactionId,
        ).sequence,
      ).toBe(before.watermark + 1);
    } finally {
      simulator.off("request", record);
    }
  }
});
