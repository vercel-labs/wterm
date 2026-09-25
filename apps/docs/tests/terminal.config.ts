import { defineConfig, devices } from "@playwright/test";

if (!process.env.DOCS_TEST_URL) {
  throw new Error(
    "Run pnpm --filter @wterm/docs test:terminal after building.",
  );
}

export default defineConfig({
  testDir: ".",
  testMatch: "terminal.spec.ts",
  outputDir: "../../../e2e/test-results/docs-terminal",
  fullyParallel: true,
  workers: process.env.CI ? 1 : 3,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.DOCS_TEST_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
