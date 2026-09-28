import { defineConfig, devices } from "@playwright/test";

if (!process.env.WTERM_PTY_URL)
  throw new Error("Run pnpm bench:performance so the runner owns its server.");

export default defineConfig({
  testDir: "./tests",
  testMatch: "performance.bench.ts",
  outputDir: "../test-results/performance",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: [
    [process.env.CI ? "github" : "list"],
    [
      "./tests/load-reporter.ts",
      {
        name: "performance.json",
        measurementNotes:
          "Production build, fresh browser context per case. Startup measures the loader through core initialization and first cell read, excluding JS import, fonts and DOM rendering; the browser engine may retain compiled code across contexts. Scrolling/redraw exclude preparation and final assertions. CDP main-thread task/layout/style time is Chromium-only and includes measurement overhead. Render timings are instrumented JS durations; frame intervals are scheduling proxies, not displayed FPS. WASM values are linear memory capacity, not resident physical memory. Both cores retain exactly 871 history rows. No performance thresholds are applied; compare repeated runs on the same host/browser with matching fixture hashes.",
      },
    ],
  ],
  use: {
    baseURL: process.env.WTERM_PTY_URL,
    viewport: { width: 1280, height: 900 },
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
