import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("timestamp search matches displayed local dates and times as well as UTC ISO across a date boundary", async ({
  browser,
  request,
}) => {
  const inputs = [
    { timestamp: "2031-12-30T23:45:30Z", status: "Completed" },
    { timestamp: "2031-12-31T03:15:45Z", status: "Failed" },
    { timestamp: "2032-01-01T01:15:45Z", status: "Completed" },
  ].map((input) => ({
    ...input,
    transactionId: randomUUID(),
    amount: 12.5,
    currency: "USD",
  }));
  for (const input of inputs)
    expect(
      (
        await request.post("http://127.0.0.1:5091/api/transactions", {
          data: input,
        })
      ).status(),
    ).toBe(201);

  for (const timezoneId of ["Asia/Jerusalem", "UTC"]) {
    const context = await browser.newContext({ timezoneId });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5183/monitor");
      const search = page.getByLabel("Search transactions");
      const localTime =
        timezoneId === "Asia/Jerusalem" ? "01:45:30" : "23:45:30";
      const numericDate =
        timezoneId === "Asia/Jerusalem" ? "31/12/2031" : "30/12/2031";
      const displayDate =
        timezoneId === "Asia/Jerusalem" ? "31 Dec 2031" : "30 Dec 2031";
      const localIsoDate =
        timezoneId === "Asia/Jerusalem" ? "2031-12-31" : "2031-12-30";

      for (const query of [
        localTime,
        localTime.slice(0, 5),
        `${numericDate} ${localTime}`,
        `${displayDate} ${localTime}`,
        `${localIsoDate}T${localTime}`,
        `${localIsoDate} ${localTime}`,
        inputs[0].timestamp,
        "2031-12-30T23:45:30.000Z",
      ]) {
        await search.fill(query);
        await expect(page.locator("tbody tr")).toHaveCount(1);
        await expect(
          page.locator("tbody tr .transaction-id [title]"),
        ).toHaveAttribute("title", inputs[0].transactionId);
        await expect(page.locator("tbody .timestamp time")).toContainText(localTime);
        await expect(page.locator("tbody .timestamp time small")).toHaveText(displayDate);
        await expect(page.locator("tbody .row-number")).toHaveText("1");
      }

      await search.fill("31/12/2031");
      await expect(page.locator("tbody tr")).toHaveCount(
        timezoneId === "Asia/Jerusalem" ? 2 : 1,
      );
      await page.getByRole("button", { name: /^Failed/ }).click();
      await expect(page.locator("tbody tr")).toHaveCount(1);
      await expect(
        page.locator("tbody tr .transaction-id [title]"),
      ).toHaveAttribute("title", inputs[1].transactionId);
      await search.fill(localTime);
      await expect(page.locator("tbody tr")).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});
