import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { attachReport } from "./report";
import type { StabilityReport } from "../src/stability";
import {
  STABILITY_PROFILES,
  STABILITY_SAMPLE_LIMIT,
  STABILITY_HISTORY_BYTES,
  STABILITY_WARMUP_BYTES,
  STABILITY_BATCH_ROWS,
  STABILITY_COLS,
  STABILITY_ROWS,
  STABILITY_MAX_BYTES,
  stabilityBatch,
  type StabilityProfile,
} from "../src/stability-workload";

const requestedProfile = process.env.WTERM_STABILITY_PROFILE ?? "smoke";
if (requestedProfile !== "smoke" && requestedProfile !== "soak")
  throw new Error("WTERM_STABILITY_PROFILE must be smoke or soak");
const profile: StabilityProfile = requestedProfile;
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  workloadSha256: hash(
    readFileSync(new URL("../src/stability-workload.ts", import.meta.url)),
  ),
  firstBatchSha256: hash(stabilityBatch(0)),
  builtinWasmSha256: hash(
    readFileSync(
      new URL("../../../packages/@wterm/core/wasm/wterm.wasm", import.meta.url),
    ),
  ),
  ghosttyWasmSha256: hash(
    readFileSync(
      new URL(
        "../../../packages/@wterm/ghostty/wasm/ghostty-vt.wasm",
        import.meta.url,
      ),
    ),
  ),
};

for (const core of ["builtin", "ghostty"]) {
  test(`${core} sustained output`, async ({ page, browser }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (errors.length < 16) errors.push(error.message);
    });
    await page.goto(`/stability.html?core=${core}`);
    await expect(page.locator("#status")).toHaveText("Ready");
    const host = await (await page.request.get("/health")).json();
    expect(host.activePtys).toBe(0);
    expect(host.serving).toBe("production");
    let report: StabilityReport | null = null;
    let lastProgress = 0;
    try {
      await page.evaluate((profile: StabilityProfile) => {
        void window.terminalStability.run(profile);
      }, profile);
      await expect
        .poll(
          async () => {
            report = await page.evaluate(() =>
              window.terminalStability.report(),
            );
            if (
              profile === "soak" &&
              report &&
              report.elapsedMs - lastProgress >= 60000
            ) {
              lastProgress = report.elapsedMs;
              const sample = report.samples.at(-1);
              console.log(
                JSON.stringify({
                  core,
                  measuredSeconds: Math.round(report.measuredMs / 1000),
                  measuredMiB: +(report.measuredBytes / 1024 / 1024).toFixed(2),
                  verifiedRows: report.verifiedRows,
                  verifiedFrames: report.verifiedFrames,
                  resources: sample,
                }),
              );
            }
            return report?.phase === "finished";
          },
          {
            intervals: [profile === "soak" ? 10000 : 250],
            timeout: STABILITY_PROFILES[profile].durationMs + 120000,
          },
        )
        .toBe(true);
      // Polling retains the most recent bounded report even if the page closes.
      report = await page.evaluate(() => window.terminalStability.report());
      expect(report).not.toBeNull();
      if (!report) throw new Error("Missing stability report");
      expect(report.error).toBeNull();
      expect(report.complete).toBe(true);
      expect(report.measuredMs).toBeGreaterThanOrEqual(
        STABILITY_PROFILES[profile].durationMs,
      );
      expect(report.measuredBytes).toBeGreaterThanOrEqual(
        STABILITY_PROFILES[profile].minimumBytes,
      );
      expect(report.outputBytes).toBeGreaterThanOrEqual(
        STABILITY_WARMUP_BYTES + report.measuredBytes,
      );
      expect(report.verifiedRows % STABILITY_BATCH_ROWS).toBe(0);
      expect(report.lastVerifiedRow).toBe(report.verifiedRows - 1);
      expect(report.firstMeasuredRow).toBeGreaterThan(0);
      expect(report.measuredFrames).toBeGreaterThan(0);
      expect(report.samples.length).toBeGreaterThanOrEqual(4);
      expect(report.samples.length).toBeLessThanOrEqual(STABILITY_SAMPLE_LIMIT);
      const measured = report.samples.filter(
        (sample) => sample.phase !== "warmup",
      );
      for (const sample of measured) {
        expect(sample.wasmBytes).toBe(measured[0].wasmBytes);
        expect(sample.mountedRows).toBeLessThan(200);
        expect(sample.discardedRows).toBeGreaterThan(0);
      }
      expect(report.frameIntervals.count).toBeGreaterThan(0);
      expect(report.taskDelays.count).toBeGreaterThan(0);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(() => window.terminalStability.running()),
      ).toBe(false);
    } finally {
      if (!page.isClosed()) {
        try {
          report = await page.evaluate(() => {
            window.terminalStability.abort();
            return window.terminalStability.report();
          });
        } catch {
          // Preserve the last sample if the browser has already failed.
        }
      }
      await attachReport(testInfo, "stability.json", {
        core,
        profile,
        source,
        host,
        browser: browser.version(),
        project: testInfo.project.name,
        repeat: testInfo.repeatEachIndex,
        headless: testInfo.project.use.headless !== false,
        configuredHistoryBytes:
          core === "ghostty" ? STABILITY_HISTORY_BYTES : null,
        workload: {
          cols: STABILITY_COLS,
          rows: STABILITY_ROWS,
          batchRows: STABILITY_BATCH_ROWS,
          warmupBytes: STABILITY_WARMUP_BYTES,
          maximumBytes: STABILITY_MAX_BYTES,
          ...STABILITY_PROFILES[profile],
        },
        errors,
        measurement: report,
      });
    }
  });
}

test("cancelling a run stops producers and frame instrumentation", async ({
  page,
}) => {
  await page.goto("/stability.html?core=ghostty");
  await expect(page.locator("#status")).toHaveText("Ready");
  await page.evaluate(() => {
    void window.terminalStability.run("smoke");
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.terminalStability.report()?.verifiedRows ?? 0),
    )
    .toBeGreaterThan(16);
  const stopped = await page.evaluate(() => {
    window.terminalStability.abort();
    return window.terminalStability.report();
  });
  expect(stopped?.complete).toBe(false);
  expect(stopped?.error).toBe("Cancelled");
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.terminalStability.report())).toEqual(
    stopped,
  );
  expect(await page.evaluate(() => window.terminalStability.running())).toBe(
    false,
  );
});

test("missing output fails row verification and leaves a bounded partial report", async ({
  page,
}) => {
  await page.goto("/stability.html?core=ghostty");
  await expect(page.locator("#status")).toHaveText("Ready");
  const report = await page.evaluate(() => {
    window.terminalStability.dropNextWrite();
    return window.terminalStability.run("smoke");
  });
  expect(report.complete).toBe(false);
  expect(report.error).toMatch(/cursor|Parsed text/);
  expect(report.verifiedRows).toBe(0);
  expect(report.outputBytes).toBeGreaterThan(0);
  expect(report.samples.length).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => window.terminalStability.running())).toBe(
    false,
  );
});

test("stalled painting cannot pass on parsed output alone", async ({
  page,
}) => {
  await page.goto("/stability.html?core=ghostty");
  await expect(page.locator("#status")).toHaveText("Ready");
  const report = await page.evaluate(() => {
    window.terminalStability.pauseRendering(true);
    return window.terminalStability.run("smoke");
  });
  expect(report.complete).toBe(false);
  expect(report.error).toBe("Terminal rendering stalled for five seconds");
  expect(report.verifiedRows).toBeGreaterThan(0);
  expect(report.verifiedFrames).toBe(0);
  const bytes = report.outputBytes;
  await page.evaluate(() => window.terminalStability.pauseRendering(false));
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(() => window.terminalStability.report()?.outputBytes),
  ).toBe(bytes);
});

test("a resource limit failure retains the sample that exceeded it", async ({
  page,
}) => {
  await page.goto("/stability.html?core=ghostty");
  await expect(page.locator("#status")).toHaveText("Ready");
  await page.evaluate(() => {
    void window.terminalStability.run("smoke");
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 200; index++) {
      const row = document.createElement("div");
      row.className = "term-row term-scrollback-row";
      row.hidden = true;
      fragment.append(row);
    }
    document.querySelector("#terminal")!.append(fragment);
  });
  await expect(page.locator("#status")).toHaveText("Failed");
  const report = await page.evaluate(() => window.terminalStability.report());
  expect(report?.complete).toBe(false);
  expect(report?.error).toBe("Mounted terminal rows exceeded the bound");
  expect(report?.samples.at(-1)?.mountedRows).toBeGreaterThanOrEqual(200);
  expect(await page.evaluate(() => window.terminalStability.running())).toBe(
    false,
  );
});
