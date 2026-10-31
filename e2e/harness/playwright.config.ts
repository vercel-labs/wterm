import { defineConfig, devices } from "@playwright/test";

if (!process.env.WTERM_PTY_URL) {
  throw new Error(
    "Run pnpm test:pty so the runner owns the PTY server lifecycle.",
  );
}

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  outputDir: "../test-results/pty",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    [process.env.CI ? "github" : "list"],
    ["./tests/baseline-reporter.ts"],
  ],
  use: {
    baseURL: process.env.WTERM_PTY_URL,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
