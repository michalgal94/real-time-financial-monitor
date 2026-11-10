import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("empty dashboard connects over a real websocket and works on mobile", async ({
  page,
}) => {
  const socket = page.waitForEvent("websocket", (socket) =>
    socket.url().includes("/hubs/transactions"),
  );
  await page.goto("/monitor");
  expect((await socket).url()).toContain("/hubs/transactions");
  await expect(
    page.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Ready when your transactions are"),
  ).toBeVisible();
  await page.screenshot({
    path: "../docs/screenshots/monitor-empty.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Live Financial Monitor" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/screenshots/monitor-mobile.png",
    fullPage: true,
  });
});

test("POST broadcasts to two monitors, retries deduplicate and statuses update", async ({
  context,
  request,
}) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/monitor"), second.goto("/monitor")]);
  for (const page of [first, second])
    await expect(
      page.getByText("Live connection", { exact: true }),
    ).toBeVisible();
  const input = {
    transactionId: randomUUID(),
    amount: 1500.5,
    currency: "USD",
    status: "Pending",
    timestamp: new Date().toISOString(),
  };
  expect(
    (await request.post("/api/transactions", { data: input })).status(),
  ).toBe(201);
  for (const page of [first, second]) {
    const row = page
      .getByRole("row")
      .filter({ hasText: input.transactionId.slice(0, 8) });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Pending", { exact: true })).toBeVisible();
  }
  expect(
    (await request.post("/api/transactions", { data: input })).status(),
  ).toBe(200);
  expect(
    (
      await request.post("/api/transactions", {
        data: { ...input, status: "Completed" },
      })
    ).status(),
  ).toBe(201);
  for (const page of [first, second])
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: input.transactionId.slice(0, 8) })
        .getByText("Completed", { exact: true }),
    ).toBeVisible();
  expect(
    (await request.post("/api/transactions", { data: input })).status(),
  ).toBe(409);
  await first.close();
  await second.close();
});

test("simulator sends manual data and 100 transactions while monitor stays interactive", async ({
  context,
  page,
}) => {
  const monitor = await context.newPage();
  await monitor.goto("/monitor");
  await expect(
    monitor.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  const before = Number(
    await monitor.locator(".panel-heading .count-pill").textContent(),
  );
  await page.goto("/add");
  await page.getByLabel("Amount", { exact: true }).fill("42.25");
  await page
    .getByRole("button", { name: "Send transaction", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Transaction accepted");
  await expect(monitor.locator(".panel-heading .count-pill")).toHaveText(
    String(before + 1),
  );
  await page.getByRole("button", { name: "Send a burst of 100" }).click();
  await monitor.getByRole("button", { name: "Failed" }).click();
  await monitor.getByLabel("Search transactions").fill("USD");
  await expect(monitor.getByLabel("Search transactions")).toHaveValue("USD");
  await expect(page.getByRole("status")).toContainText(
    "100 transactions accepted.",
  );
  await expect(monitor.locator(".panel-heading .count-pill")).toHaveText(
    String(before + 101),
  );
  for (const row of await monitor.locator("tbody tr").all()) {
    await expect(row).toContainText("Failed");
    await expect(row).toContainText("USD");
  }
  await monitor.getByRole("button", { name: "All transactions" }).click();
  await monitor.getByLabel("Search transactions").clear();
  await expect(monitor.locator("tbody tr")).toHaveCount(10);
  await monitor.getByRole("button", { name: "Next page" }).click();
  await expect(monitor.locator(".table-footer")).toContainText("Showing 11–20");
  await monitor.getByRole("button", { name: "Previous page" }).click();
  await monitor.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => window.scrollTo(0, 0));
  await monitor.screenshot({
    path: "../docs/screenshots/monitor-live.png",
    fullPage: true,
  });
  await page.screenshot({
    path: "../docs/screenshots/simulator.png",
    fullPage: true,
  });
  await monitor.close();
});

test("reconnect recovers a transaction ingested while the browser was offline", async ({
  page,
  context,
  request,
}) => {
  // Chromium offline mode leaves existing WebSockets open, so close them explicitly.
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes("/hubs/transactions")) sockets.push(this);
      }
    };
    Object.defineProperty(window, "__testSockets", { value: sockets });
  });
  await page.goto("/monitor");
  await expect(
    page.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => {
    for (const socket of (window as Window & { __testSockets: WebSocket[] })
      .__testSockets)
      socket.close();
  });
  await expect(page.locator(".connection-label")).not.toHaveText(
    "Live connection",
  );
  const transactionId = randomUUID();
  expect(
    (
      await request.post("/api/transactions", {
        data: {
          transactionId,
          amount: 78.9,
          currency: "EUR",
          status: "Failed",
          timestamp: new Date().toISOString(),
        },
      })
    ).status(),
  ).toBe(201);
  await context.setOffline(false);
  await expect(
    page.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: transactionId.slice(0, 8) }),
  ).toHaveCount(1);
});

for (const range of [
  {
    timezoneId: "UTC",
    date: "2031-12-31",
    before: "2031-12-30T23:59:59.999Z",
    first: "2031-12-31T00:00:00Z",
    last: "2031-12-31T23:59:59.999Z",
    after: "2032-01-01T00:00:00Z",
  },
  {
    timezoneId: "Asia/Jerusalem",
    date: "2032-01-15",
    before: "2032-01-14T21:59:59.999Z",
    first: "2032-01-14T22:00:00Z",
    last: "2032-01-15T21:59:59.999Z",
    after: "2032-01-15T22:00:00Z",
  },
  {
    timezoneId: "America/New_York",
    date: "2024-03-10",
    before: "2024-03-10T04:59:59.999Z",
    first: "2024-03-10T05:00:00Z",
    last: "2024-03-11T03:59:59.999Z",
    after: "2024-03-11T04:00:00Z",
  },
]) {
  test(`date range includes the whole local day in ${range.timezoneId} and combines with existing filters`, async ({
    browser,
    request,
    baseURL,
  }) => {
    const prefix = randomUUID().slice(0, 8);
    const inputs = [
      {
        timestamp: range.before,
        status: "Completed",
        amount: 84.25,
        currency: "USD",
      },
      {
        timestamp: range.first,
        status: "Completed",
        amount: 84.25,
        currency: "USD",
      },
      { timestamp: range.last, status: "Failed", amount: 99.5, currency: "EUR" },
      { timestamp: range.after, status: "Failed", amount: 99.5, currency: "USD" },
    ].map((input) => ({
      ...input,
      transactionId: `${prefix}-${randomUUID().slice(9)}`,
    }));
    for (const input of inputs)
      expect(
        (await request.post("/api/transactions", { data: input })).status(),
      ).toBe(201);

    const context = await browser.newContext({
      timezoneId: range.timezoneId,
      baseURL,
    });
    try {
      const page = await context.newPage();
      await page.goto("/monitor");
      await expect(
        page.getByText("Live connection", { exact: true }),
      ).toBeVisible();
      const rows = page.locator("tbody tr");
      const search = page.getByLabel("Search transactions");
      const from = page.getByLabel("From date", { exact: true });
      const to = page.getByLabel("To date", { exact: true });
      const clear = page.getByRole("button", {
        name: "Clear dates",
        exact: true,
      });
      const failed = page.getByRole("button", { name: /^Failed/ });

      await search.fill(prefix);
      await expect(rows).toHaveCount(4);
      await expect(clear).toBeDisabled();
      await from.fill(range.date);
      await expect(rows).toHaveCount(3);
      await to.fill(range.date);
      await expect(rows).toHaveCount(2);
      for (const input of [inputs[1], inputs[2]])
        await expect(
          rows.locator(`.transaction-id [title="${input.transactionId}"]`),
        ).toHaveCount(1);

      await failed.click();
      await expect(rows).toHaveCount(1);
      await search.fill("EUR");
      await expect(rows.locator(".transaction-id [title]")).toHaveAttribute(
        "title",
        inputs[2].transactionId,
      );
      await search.fill("84.25");
      await expect(rows).toHaveCount(0);
      await page
        .getByRole("button", { name: "All transactions", exact: true })
        .click();
      await expect(rows.locator(".transaction-id [title]")).toHaveAttribute(
        "title",
        inputs[1].transactionId,
      );

      await search.fill(prefix);
      await failed.click();
      await clear.click();
      await expect(rows).toHaveCount(2);
      await expect(search).toHaveValue(prefix);
      await expect(failed).toHaveClass("selected");
      await expect(from).toHaveValue("");
      await expect(to).toHaveValue("");
      await expect(clear).toBeDisabled();

      await to.fill(range.date);
      await expect(rows.locator(".transaction-id [title]")).toHaveAttribute(
        "title",
        inputs[2].transactionId,
      );
      await clear.click();
      await expect(rows).toHaveCount(2);
    } finally {
      await context.close();
    }
  });
}

test("date filtering resets pagination, handles live arrivals and invalid ranges, and fits mobile", async ({
  browser,
  request,
  baseURL,
}) => {
  const prefix = randomUUID().slice(0, 8);
  const makeInput = (timestamp: string) => ({
    transactionId: `${prefix}-${randomUUID().slice(9)}`,
    amount: 37.5,
    currency: "USD",
    status: "Completed",
    timestamp,
  });
  for (let index = 0; index < 14; index++) {
    const input = makeInput(`2034-01-${index < 12 ? "15" : "16"}T12:00:00Z`);
    expect(
      (await request.post("/api/transactions", { data: input })).status(),
    ).toBe(201);
  }

  const context = await browser.newContext({ timezoneId: "UTC", baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/monitor");
    await expect(
      page.getByText("Live connection", { exact: true }),
    ).toBeVisible();
    const rows = page.locator("tbody tr");
    const search = page.getByLabel("Search transactions");
    const from = page.getByLabel("From date", { exact: true });
    const to = page.getByLabel("To date", { exact: true });
    await search.fill(prefix);
    await expect(rows).toHaveCount(10);
    await page
      .getByRole("button", { name: "Next page", exact: true })
      .click();
    await expect(rows).toHaveCount(4);
    await expect(rows.first().locator(".row-number")).toHaveText("11");

    await from.fill("2034-01-16");
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator(".row-number")).toHaveText("1");
    await to.fill("2034-01-16");
    const before = Number(
      await page.locator(".panel-heading .count-pill").textContent(),
    );
    for (const timestamp of [
      "2034-01-16T23:59:59.999Z",
      "2034-01-17T00:00:00Z",
    ])
      expect(
        (
          await request.post("/api/transactions", {
            data: makeInput(timestamp),
          })
        ).status(),
      ).toBe(201);
    await expect(page.locator(".panel-heading .count-pill")).toHaveText(
      String(before + 2),
    );
    await expect(rows).toHaveCount(3);
    await page.screenshot({
      path: "../artifacts/audit/date-range-desktop.png",
      fullPage: true,
    });

    await from.fill("2034-01-18");
    await expect(page.getByRole("alert")).toHaveText(
      "From date must be on or before To date.",
    );
    await expect(from).toHaveAttribute("aria-invalid", "true");
    await expect(to).toHaveAttribute("aria-invalid", "true");
    await expect(rows).toHaveCount(0);
    await page
      .getByRole("button", { name: "Clear dates", exact: true })
      .click();
    await expect(search).toHaveValue(prefix);
    await expect(rows).toHaveCount(10);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".table-footer")).toContainText("of 16");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(from).toBeVisible();
    await expect(to).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "../artifacts/audit/date-range-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
