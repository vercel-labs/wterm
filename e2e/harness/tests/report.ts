import type { TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function attachReport(
  testInfo: TestInfo,
  name: string,
  report: unknown,
) {
  const path = testInfo.outputPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
}
