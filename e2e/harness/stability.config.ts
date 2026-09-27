import { defineConfig, devices } from "@playwright/test";

if (!process.env.WTERM_PTY_URL)
  throw new Error("Run pnpm bench:stability so the runner owns its server.");
export default defineConfig({
  testDir: "./tests",
  testMatch: "stability.bench.ts",
  outputDir: "../test-results/stability",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout:
    process.env.WTERM_STABILITY_PROFILE === "soak" ? 33 * 60 * 1000 : 60000,
  reporter: [
    [process.env.CI ? "github" : "list"],
    [
      "./tests/load-reporter.ts",
      {
        name: "stability.json",
        measurementNotes:
          "Synchronous synthetic ANSI output in batches of 16 numbered rows. Every parsed row is checked before another batch can discard it; rendered frames are checked against the latest batch. One timer task per batch; generation, assertions and resource sampling affect throughput and heap usage. WASM capacity must remain stable after history-pruning warmup. JS heap samples include harness allocations and ordinary GC; they are not process memory or proof of leak freedom. No PTY, network, graphics or input-latency acceptance is implied.",
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
