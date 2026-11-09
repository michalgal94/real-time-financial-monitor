import { test, expect, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function expectNumbers(rows: Locator, numbers: number[]) {
  await expect(rows.locator(".row-number")).toHaveText(numbers.map(String));
}

test("row numbers follow filtered positions, continue across pages and remain independent of event sequences", async ({
  context,
  request,
}) => {
  const prefix = randomUUID().slice(0, 8);
  const inputs = Array.from({ length: 14 }, (_, index) => ({
    transactionId: prefix + randomUUID().slice(8),
    amount: 15.5,
    currency: "USD",
    status: index < 10 ? "Pending" : "Failed",
    timestamp: new Date().toISOString(),
  }));
  for (const input of inputs)
    expect(
      (
        await request.post("http://127.0.0.1:5090/api/transactions", {
          data: input,
        })
      ).status(),
    ).toBe(201);

  const monitor = await context.newPage();
  await monitor.goto("http://127.0.0.1:5183/monitor");
  await monitor.getByLabel("Search transactions").fill(prefix);
  await expectNumbers(
    monitor.locator("tbody tr"),
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
  await expect(
    monitor.getByRole("columnheader", { name: "Row number", exact: true }),
  ).toBeVisible();
  await expect(
    monitor.getByRole("columnheader", { name: "LATEST EVENT", exact: true }),
  ).toHaveCount(0);
  await monitor.getByRole("button", { name: "Next page", exact: true }).click();
  await expectNumbers(monitor.locator("tbody tr"), [11, 12, 13, 14]);

  await monitor.getByRole("button", { name: /^Failed/ }).click();
  await expectNumbers(monitor.locator("tbody tr"), [1, 2, 3, 4]);
  await monitor.getByLabel("Search transactions").fill(inputs[0].transactionId);
  await expect(monitor.locator("tbody tr")).toHaveCount(0);
  await monitor
    .getByRole("button", { name: "All transactions", exact: true })
    .click();
  await expectNumbers(monitor.locator("tbody tr"), [1]);

  expect(
    (
      await request.patch(
        `http://127.0.0.1:5091/api/transactions/${inputs[0].transactionId}/status`,
        { data: { status: "Completed" } },
      )
    ).status(),
  ).toBe(200);
  await expect(
    monitor.locator("tbody tr").getByText("Completed", { exact: true }),
  ).toBeVisible();
  await expectNumbers(monitor.locator("tbody tr"), [1]);
  await monitor.getByLabel("Search transactions").fill(prefix);
  await expectNumbers(
    monitor.locator("tbody tr"),
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
  await expect(
    monitor.locator("tbody tr").first().locator(".transaction-id [title]"),
  ).toHaveAttribute("title", inputs[0].transactionId);

  const simulator = await context.newPage();
  await simulator.goto("http://127.0.0.1:5184/add");
  await expectNumbers(
    simulator.locator("#pending tbody tr"),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  await simulator
    .getByRole("button", { name: "Next pending page", exact: true })
    .click();
  await expectNumbers(simulator.locator("#pending tbody tr"), [9]);
  const recent = simulator.locator(".recent-panel").filter({
    has: simulator.getByRole("heading", {
      name: "Recently sent",
      exact: true,
    }),
  });
  await simulator
    .getByRole("button", { name: "Send transaction", exact: true })
    .click();
  await expectNumbers(recent.locator("tbody tr"), [1]);
  await simulator
    .getByRole("button", { name: "Send transaction", exact: true })
    .click();
  await expectNumbers(recent.locator("tbody tr"), [1, 2]);
});
