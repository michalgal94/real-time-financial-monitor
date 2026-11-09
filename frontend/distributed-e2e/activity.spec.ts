import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

for (const outcome of ["Completed", "Failed"] as const) {
  test(`last activity remains after ${outcome} highlights expire, reloads and replica changes`, async ({
    page,
    request,
  }) => {
    // Install the fake clock before navigation so it controls the application timers.
    await page.clock.install();
    await page.goto("http://127.0.0.1:5183/monitor");
    await expect(
      page.getByText("Live connection", { exact: true }),
    ).toBeVisible();
    const input = {
      transactionId: randomUUID(),
      amount: 127.83,
      currency: "USD",
      status: "Pending",
      // Activity age measures ingestion, independently of the producer's timestamp.
      timestamp: "2026-01-01T10:00:00Z",
    };
    expect(
      (
        await request.post("http://127.0.0.1:5091/api/transactions", {
          data: input,
        })
      ).status(),
    ).toBe(201);
    const row = page
      .locator("tbody tr")
      .filter({ hasText: input.transactionId.slice(0, 8) });
    const activity = row.locator(".last-activity");
    await expect(row).toHaveClass(/highlight-new/);
    await expect(row).toHaveCSS("animation-name", "transaction-arrival");
    await expect(activity.getByText("NEW", { exact: true })).toBeVisible();
    await expect(activity.locator(".activity-detail")).toHaveText(
      "Created · just now",
    );
    const rowHeight = await row.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await expect(activity.locator(".event-label")).toHaveCount(0, {
      timeout: 8000,
    });
    await expect(activity.locator(".activity-detail")).toHaveText(
      "Created · just now",
    );
    expect(
      await row.evaluate((element) => element.getBoundingClientRect().height),
    ).toBe(rowHeight);

    expect(
      (
        await request.patch(
          `http://127.0.0.1:5090/api/transactions/${input.transactionId}/status`,
          { data: { status: outcome } },
        )
      ).status(),
    ).toBe(200);
    await expect(activity.getByText("UPDATED", { exact: true })).toBeVisible();
    await expect(activity.locator(".activity-detail")).toHaveText(
      `Pending → ${outcome} · just now`,
    );
    await expect(row).toHaveCSS("animation-name", "transaction-update");
    await expect(activity.locator(".event-label")).toHaveCount(0, {
      timeout: 8000,
    });
    await expect(activity.locator(".activity-detail")).toHaveText(
      `Pending → ${outcome} · just now`,
    );
    expect(
      await row.evaluate((element) => element.getBoundingClientRect().height),
    ).toBe(rowHeight);

    const stored = await (
      await request.get(
        `http://127.0.0.1:5091/api/transactions/${input.transactionId}`,
      )
    ).json();
    expect(stored.activity.kind).toBe("StatusChanged");
    expect(stored.activity.previousStatus).toBe("Pending");
    await page.reload();
    await expect(activity.locator(".activity-detail")).toHaveText(
      `Pending → ${outcome} · just now`,
    );
    await expect(row).not.toHaveClass(/highlight-/);
    await expect(activity.locator(".event-label")).toHaveCount(0);

    await page.goto("http://127.0.0.1:5184/monitor");
    await expect(activity.locator(".activity-detail")).toHaveText(
      `Pending → ${outcome} · just now`,
    );
    await expect(activity.locator("time")).toHaveAttribute(
      "datetime",
      stored.activity.occurredAt,
    );
    await page.clock.fastForward(125000);
    await expect(activity.locator("time")).toHaveText("2 min ago");

    if (outcome === "Failed") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(activity.locator(".activity-detail")).toContainText(
        "Pending → Failed",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: "../docs/screenshots/last-activity.png",
        fullPage: true,
      });
    }
  });
}
