import { defineConfig } from "@playwright/test";
import load from "./load.config";
export default defineConfig(load, {
  testMatch: "pty-input.bench.ts",
  outputDir: "../test-results/pty-input",
  reporter: [
    [process.env.CI ? "github" : "list"],
    [
      "./tests/load-reporter.ts",
      {
        name: "pty-input.json",
        measurementNotes:
          "Trusted keys through a real raw-mode PTY with paced output. Driver request-to-DOM/frame reports include automation IPC and browser input queueing; browser dispatch timings exclude pre-dispatch queueing. Frame callbacks are presentation opportunities, not physical pixel timings. Serial probes, no speed thresholds; compare delivered throughput alongside latency.",
      },
    ],
  ],
});
