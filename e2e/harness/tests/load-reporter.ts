import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default class LoadReporter implements Reporter {
  private directory = "";
  private results: unknown[] = [];

  constructor(
    private options: { name?: string; measurementNotes?: string } = {},
  ) {}

  onBegin(config: FullConfig) {
    this.directory = config.projects[0].outputDir;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const attachment = result.attachments.find(
      ({ name }) => name === (this.options.name ?? "load.json"),
    );
    this.results.push({
      test: test.title,
      project: test.parent.project()?.name,
      repeat: test.repeatEachIndex,
      status: result.status,
      expectedStatus: test.expectedStatus,
      errors: result.errors.map(({ message }) => message),
      report: attachment?.path
        ? JSON.parse(readFileSync(attachment.path, "utf8"))
        : null,
    });
  }

  onEnd(result: FullResult) {
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(
      join(this.directory, this.options.name ?? "load.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          status: result.status,
          generatedAt: new Date().toISOString(),
          measurementNotes:
            this.options.measurementNotes ??
            "Synthetic output with one 16 KiB write per timer task. Instrumented browser timings include harness overhead; frame intervals and task delays are scheduling proxies, not key-to-pixel latency or a native-terminal comparison. No performance thresholds are applied.",
          results: this.results,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
