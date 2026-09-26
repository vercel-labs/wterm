import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { inputFixture, INPUT_WORKLOADS } from "../src/input-workloads";
import { attachReport } from "./report";
import { collectBrowserErrors } from "./browser-errors";

const profile = process.env.WTERM_INPUT_PROFILE ?? "smoke";
if (profile !== "smoke" && profile !== "measure")
  throw new Error("WTERM_INPUT_PROFILE must be smoke or measure");
const probes = profile === "measure" ? 256 : 16;
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
  for (const sessions of [1, 8]) {
    for (const workload of INPUT_WORKLOADS) {
      test(`${core} ${sessions} sessions ${workload} input`, async ({
        page,
        browser,
      }, testInfo) => {
        const chunks = inputFixture(workload);
        const hash = createHash("sha256");
        chunks.forEach((chunk) => hash.update(chunk));
        const fixture = {
          sha256: hash.digest("hex"),
          chunkBytes: chunks.map((chunk) => chunk.length),
        };
        const browserErrors = collectBrowserErrors(page);
        const host = await (await page.request.get("/health")).json();
        try {
          expect(host.activePtys).toBe(0);
          expect(host.serving).toBe("production");
          await page.goto(`/input.html?core=${core}&sessions=${sessions}`);
          await expect(page.locator("#status")).toHaveText("Ready");
          await page.evaluate(
            ({ workload, probes }) =>
              window.terminalInput.start(workload, probes),
            { workload, probes },
          );
          await page.waitForFunction(() => {
            const state = window.terminalInput.progress();
            if (state.error) throw new Error(state.error);
            return state.outputStarted;
          });
          for (let i = 0; i < probes; i++) {
            await page.keyboard.press(String.fromCharCode(97 + (i % 26)));
            await page.waitForFunction((completed) => {
              const state = window.terminalInput.progress();
              if (state.error) throw new Error(state.error);
              return state.completed === completed;
            }, i + 1);
          }
          const report = await page.evaluate(() =>
            window.terminalInput.finish(),
          );
          expect(report.complete, report.error ?? "").toBe(true);
          expect(report.probes).toMatchObject({
            started: probes,
            completed: probes,
            pending: false,
          });
          for (const timing of [
            report.probes.keyDispatchToDOMMs,
            report.probes.keyDispatchToFrameMs,
          ]) {
            expect(timing.count).toBe(probes);
            expect(timing.retained).toBe(probes);
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
          expect(
            report.probes.keyDispatchToFrameMs.mean!,
          ).toBeGreaterThanOrEqual(report.probes.keyDispatchToDOMMs.mean!);
          expect(report.sessions).toHaveLength(sessions);
          for (const [i, session] of report.sessions.entries()) {
            expect(session.active).toBe(i === 0);
            if (i === 0) expect(session.renderMs.count).toBeGreaterThan(0);
            else expect(session.renderMs.count).toBe(0);
            expect(session.writeMs.count).toBe(session.writes);
            if (workload === "idle") {
              expect(session.writes).toBe(0);
              expect(session.outputBytes).toBe(0);
            } else {
              expect(session.writes).toBeGreaterThan(0);
              const totalCycle = chunks.reduce(
                (total, chunk) => total + chunk.length,
                0,
              );
              const expectedBytes =
                Math.floor(session.writes / chunks.length) * totalCycle +
                chunks
                  .slice(0, session.writes % chunks.length)
                  .reduce((total, chunk) => total + chunk.length, 0);
              expect(session.outputBytes).toBe(expectedBytes);
              expect(session.deliveredMiBPerSecond).toBeGreaterThan(0);
              const batch = String(
                (session.writes - 1) % chunks.length,
              ).padStart(2, "0");
              expect(session.finalScreen.slice(1).join("\n")).toContain(
                `batch ${batch} row`,
              );
            }
            if (i === 0)
              expect(session.finalScreen[0]).toBe(
                `echo ${String(probes).padStart(4, "0")}: ${String.fromCharCode(97 + ((probes - 1) % 26))}`,
              );
          }
          for (const snapshot of Object.values(report.resources)) {
            expect(snapshot.sessions).toHaveLength(sessions);
            for (const session of snapshot.sessions) {
              expect(session.wasmLinearMemoryBytes).toBeGreaterThan(0);
              expect(session.mountedRows).toBeLessThan(200);
            }
          }
          expect(browserErrors.errors).toEqual([]);
        } finally {
          if (!page.isClosed()) {
            const measurement = await page.evaluate(() => {
              window.terminalInput?.abort("Automation ended before completion");
              return window.terminalInput?.report() ?? null;
            });
            await attachReport(testInfo, "input.json", {
              core,
              sessions,
              workload,
              profile,
              probes,
              fixture,
              source,
              host,
              browser: browser.version(),
              headless: testInfo.project.use.headless ?? true,
              browserErrors,
              project: testInfo.project.name,
              repeat: testInfo.repeatEachIndex,
              measurement,
            });
          }
        }
      });
    }
  }
}
