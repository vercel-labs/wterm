import { defineConfig, devices } from "@playwright/test";

if (!process.env.WTERM_PTY_URL)
  throw new Error("Run pnpm bench:terminal so the runner owns its server.");

export default defineConfig({
  testDir: "./tests",
  testMatch: "load.bench.ts",
  outputDir: "../test-results/load",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  reporter: [
    [process.env.CI ? "github" : "list"],
    ["./tests/load-reporter.ts"],
  ],
  use: {
    baseURL: process.env.WTERM_PTY_URL,
    viewport: { width: 1280, height: 900 },
    // Tracing, video, and screenshots during a run distort the workload.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--enable-precise-memory-info"] },
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
