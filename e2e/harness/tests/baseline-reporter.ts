import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default class BaselineReporter implements Reporter {
  private outputDir = "";
  private results: unknown[] = [];

  onBegin(config: FullConfig): void {
    this.outputDir = config.projects[0].outputDir;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find(
      ({ name }) =>
        name === "replay-baseline.json" || name === "pty-baseline.json",
    );
    const report = attachment?.path
      ? JSON.parse(readFileSync(attachment.path, "utf8"))
      : {};
    const { checkpoints, ...measurements } = report;
    this.results.push({
      ...measurements,
      test: test.title,
      project: test.parent.project()?.name,
      status: result.status,
      expectedStatus: test.expectedStatus,
      durationMs: result.duration,
      checkpoints: checkpoints?.map(({ name }: { name: string }) => name),
    });
  }

  onEnd(result: FullResult): void {
    mkdirSync(this.outputDir, { recursive: true });
    writeFileSync(
      join(this.outputDir, "baseline.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          status: result.status,
          generatedAt: new Date().toISOString(),
          timingNotes:
            "Synchronous writes and animation-callback opportunities, not pixel presentation. Replay has no PTY/network latency and omits capture delays. No performance thresholds are applied.",
          results: this.results,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
