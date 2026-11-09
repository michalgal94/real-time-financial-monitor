import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("existing Pending transactions can be completed or failed, with visible live highlights", async ({
  page,
  context,
  request,
}) => {
  const monitor = await context.newPage();
  await monitor.goto("/monitor");
  await expect(
    monitor.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  await page.goto("/add");
  for (const outcome of ["Completed", "Failed"] as const) {
    const input = {
      transactionId: randomUUID(),
      amount: 18.75,
      currency: "USD",
      status: "Pending",
      timestamp: new Date().toISOString(),
    };
    expect(
      (await request.post("/api/transactions", { data: input })).status(),
    ).toBe(201);
    const row = monitor
      .locator("tbody tr")
      .filter({ hasText: input.transactionId.slice(0, 8) });
    await expect(row).toHaveClass(/highlight-new/);
    await expect(row.getByText("NEW", { exact: true })).toBeVisible();
    await expect(row).toHaveCSS("animation-name", "transaction-arrival");
    const before = await monitor
      .locator(".panel-heading .count-pill")
      .textContent();
    const pendingRow = page
      .locator("#pending tbody tr")
      .filter({ hasText: input.transactionId.slice(0, 8) });
    await pendingRow
      .getByRole("button", {
        name: outcome === "Completed" ? "Complete" : "Mark failed",
        exact: true,
      })
      .click();
    await expect(row.getByText(outcome, { exact: true })).toBeVisible();
    await expect(row).toHaveClass(/highlight-updated/);
    await expect(row.getByText("UPDATED", { exact: true })).toBeVisible();
    await expect(row.locator(".status-history")).toHaveText(
      `Pending → ${outcome}`,
    );
    await expect(row).toHaveCSS("animation-name", "transaction-update");
    await expect(row.locator(".status-badge")).toHaveCSS(
      "animation-name",
      "status-confirmation",
    );
    await expect(monitor.locator(".panel-heading .count-pill")).toHaveText(
      before!,
    );
    await expect(pendingRow).toHaveCount(0);
    const stored = await (
      await request.get(`/api/transactions/${input.transactionId}`)
    ).json();
    expect(stored.transactionId).toBe(input.transactionId);
    expect(stored.amount).toBe(input.amount);
    expect(stored.status).toBe(outcome);
    if (outcome === "Failed") {
      await monitor.screenshot({
        path: "../docs/screenshots/status-update.png",
        fullPage: true,
      });
      await monitor.emulateMedia({ reducedMotion: "reduce" });
      await expect(row).toHaveCSS("animation-name", "none");
      await expect(row.getByText("Failed", { exact: true })).toBeVisible();
    }
  }
  await monitor.close();
});

test("the explicit lifecycle demo resolves the same ID and recent submissions reflect its current status", async ({
  page,
}) => {
  await page.goto("/add");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/transactions") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run Pending → Completed demo", exact: true })
    .click();
  const transaction = await (await created).json();
  expect(transaction.status).toBe("Pending");
  await expect(
    page.getByRole("status").filter({ hasText: "Demo complete:" }),
  ).toBeVisible();
  const recent = page
    .locator(".recent-panel")
    .filter({ has: page.getByRole("heading", { name: "Recently sent" }) });
  await expect(
    recent
      .getByRole("row")
      .filter({ hasText: transaction.transactionId.slice(0, 8) })
      .getByText("Completed", { exact: true }),
  ).toBeVisible();
});
