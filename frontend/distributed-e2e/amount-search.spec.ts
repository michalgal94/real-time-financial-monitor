import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("amount search accepts the displayed currency format, trailing zeros and surrounding whitespace", async ({
  page,
  request,
}) => {
  const inputs = [1500.5, 1500, 4000.08, 0.08].map((amount, index) => ({
    transactionId: randomUUID(),
    amount,
    currency: "USD",
    status: index === 2 ? "Failed" : "Completed",
    timestamp: new Date().toISOString(),
  }));
  for (const input of inputs)
    expect(
      (
        await request.post("http://127.0.0.1:5091/api/transactions", {
          data: input,
        })
      ).status(),
    ).toBe(201);
  await page.goto("http://127.0.0.1:5183/monitor");
  const search = page.getByLabel("Search transactions");
  for (const query of [
    "1500.50",
    "1,500.50",
    "$1,500.50",
    "  $1,500.50  ",
    "USD 1,500.50",
  ]) {
    await search.fill(query);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(
      page.locator("tbody tr .transaction-id [title]"),
    ).toHaveAttribute("title", inputs[0].transactionId);
    await expect(page.locator("tbody .row-number")).toHaveText("1");
  }
  for (const [query, index] of [
    ["1,500.00", 1],
    ["$4,000.08", 2],
    ["$0.08", 3],
  ] as const) {
    await search.fill(query);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(
      page.locator("tbody tr .transaction-id [title]"),
    ).toHaveAttribute("title", inputs[index].transactionId);
  }
  await search.fill("$1,500.50");
  await page.getByRole("button", { name: /^Failed/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await search.fill("$4,000.08");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(
    page.locator("tbody tr").getByText("Failed", { exact: true }),
  ).toBeVisible();
});
