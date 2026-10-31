import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  describeLoad,
  expectedRows,
  loadChunks,
  LOAD_WORKLOADS,
} from "../src/load-workloads";
import { attachReport } from "./report";

const profile = process.env.WTERM_LOAD_PROFILE ?? "smoke";
if (profile !== "smoke" && profile !== "stress")
  throw new Error("WTERM_LOAD_PROFILE must be smoke or stress");
const bytes = (profile === "stress" ? 100 : 1) * 1024 * 1024;
const sha256 = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty:
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
      .length > 0,
  builtinWasmSha256: sha256(
    readFileSync(
      new URL("../../../packages/@wterm/core/wasm/wterm.wasm", import.meta.url),
    ),
  ),
  ghosttyWasmSha256: sha256(
    readFileSync(
      new URL(
        "../../../packages/@wterm/ghostty/wasm/ghostty-vt.wasm",
        import.meta.url,
      ),
    ),
  ),
};

for (const core of ["builtin", "ghostty"]) {
  for (const workload of LOAD_WORKLOADS) {
    test(`${core} ${workload} output load`, async ({
      page,
      browser,
    }, testInfo) => {
      const spec = describeLoad(workload, bytes);
      const hash = createHash("sha256");
      for (const chunk of loadChunks(spec)) hash.update(chunk);
      const fixtureSha256 = hash.digest("hex");
      await page.goto(`/load.html?core=${core}`);
      await expect(page.locator("#status")).toHaveText("Ready");
      const host = await (await page.request.get("/health")).json();
      expect(host.activePtys).toBe(0);
      expect(host.serving).toBe("production");
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      try {
        const report = await page.evaluate(
          ({ workload, bytes }) => window.terminalLoad.run(workload, bytes),
          { workload, bytes },
        );
        expect(report.complete).toBe(true);
        expect(report.outputBytes).toBe(spec.outputBytes);
        expect(report.chunks).toBe(
          Math.ceil(spec.outputBytes / spec.chunkBytes),
        );
        expect(report.timings.writeMs.count).toBe(report.chunks);
        expect(report.timings.coreWriteMs.count).toBe(report.chunks);
        for (const name of [
          "renderMs",
          "frameIntervalMs",
          "taskDelayMs",
        ] as const) {
          expect(report.timings[name].count, name).toBeGreaterThan(0);
        }
        for (const timing of Object.values(report.timings)) {
          if (timing?.count) {
            for (const value of [
              timing.mean,
              timing.max,
              timing.p50,
              timing.p95,
              timing.p99,
            ]) {
              expect(Number.isFinite(value)).toBe(true);
              expect(value).toBeGreaterThanOrEqual(0);
            }
          }
        }
        expect(report.elapsedMs).toBeGreaterThan(0);
        expect(report.deliveredMiBPerSecond).toBeGreaterThan(0);
        expect(report.resources.length).toBeGreaterThanOrEqual(2);
        for (const sample of report.resources) {
          expect(sample.wasmLinearMemoryBytes).toBeGreaterThan(0);
          // The renderer should mount a viewport and overscan, not all output.
          expect(sample.mountedRows).toBeLessThan(200);
        }
        const rendered = await page
          .locator(".term-row:not(.term-scrollback-row)")
          .allTextContents();
        expect(rendered.map((row) => row.trimEnd())).toEqual(
          expectedRows(spec),
        );
        expect(pageErrors).toEqual([]);
      } finally {
        if (!page.isClosed()) {
          await attachReport(testInfo, "load.json", {
            core,
            profile,
            fixtureSha256,
            source,
            host,
            browser: browser.version(),
            project: testInfo.project.name,
            repeat: testInfo.repeatEachIndex,
            measurement: await page.evaluate(() =>
              window.terminalLoad.report(),
            ),
          });
        }
      }
    });
  }
}
