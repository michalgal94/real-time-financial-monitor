import { defineConfig } from "@playwright/test";

const redis = process.env.TEST_REDIS_CONNECTION ?? "127.0.0.1:6379";
const prefix = `ledger-e2e-${Date.now()}`;
const storage = {
  Storage__Provider: "Redis",
  ConnectionStrings__Redis: redis,
  Redis__KeyPrefix: prefix,
  Transactions__Capacity: "1000",
};

export default defineConfig({
  outputDir: "../artifacts/distributed-test-results",
  testDir: "./distributed-e2e",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "../artifacts/audit/distributed-results.json" }],
  ],
  use: { browserName: "chromium", trace: "retain-on-failure" },
  webServer: [
    ...Array.from({ length: 5 }, (_, index) => ({
      command: `dotnet run --no-build -c Release --project ../backend/FinancialMonitor.Api --no-launch-profile --urls http://127.0.0.1:${5090 + index}`,
      env: storage,
      url: `http://127.0.0.1:${5090 + index}/health/ready`,
      timeout: 60000,
    })),
    {
      command: "npm run dev -- --port 5183",
      env: { API_PROXY_TARGET: "http://127.0.0.1:5090" },
      url: "http://127.0.0.1:5183",
      timeout: 60000,
    },
    {
      command: "npm run dev -- --port 5184",
      env: { API_PROXY_TARGET: "http://127.0.0.1:5091" },
      url: "http://127.0.0.1:5184",
      timeout: 60000,
    },
  ],
});
