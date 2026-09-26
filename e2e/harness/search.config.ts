import { defineConfig } from "@playwright/test";
import load from "./load.config";
export default defineConfig(load, {
  testMatch: "search.bench.ts",
  outputDir: "../test-results/search",
  reporter: [
    [process.env.CI ? "github" : "list"],
    [
      "./tests/load-reporter.ts",
      {
        name: "search.json",
        measurementNotes:
          "Ghostty search of a fully retained fixed ASCII corpus. Timings run from WTerm.search to incremental/final callbacks; highlight timing is an animation-frame opportunity, not physical presentation. Includes scheduling and instrumentation; excludes history preparation. No speed thresholds are applied.",
      },
    ],
  ],
});
