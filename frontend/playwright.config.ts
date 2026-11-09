import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "../artifacts/audit/e2e-results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5185",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "dotnet run --project ../backend/FinancialMonitor.Api --no-launch-profile --urls http://127.0.0.1:5085",
      env: { Storage__Provider: "Memory" },
      url: "http://127.0.0.1:5085/health/ready",
      timeout: 120000,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5185",
      env: { API_PROXY_TARGET: "http://127.0.0.1:5085" },
      url: "http://127.0.0.1:5185",
      timeout: 60000,
      reuseExistingServer: false,
    },
  ],
});
