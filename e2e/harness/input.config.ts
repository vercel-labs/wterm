import { defineConfig } from "@playwright/test";
import load from "./load.config";

export default defineConfig(load, {
  testMatch: "input*.bench.ts",
  outputDir: "../test-results/input",
  reporter: [
    [process.env.CI ? "github" : "list"],
    [
      "./tests/load-reporter.ts",
      {
        name: "input.json",
        measurementNotes:
          "Trusted keyboard dispatch to matching local-echo DOM and a subsequent animation callback. Includes instrumentation; excludes driver/OS delivery, pre-dispatch input queueing, PTY/network latency and physical presentation. Independent session producers submit one complete <=16 KiB chunk per zero-delay timer task. Serial probes are paced by completion and automation round trips, not a fixed typing rate. No performance thresholds are applied.",
      },
    ],
  ],
});
