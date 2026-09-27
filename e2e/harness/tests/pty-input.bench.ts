import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { inputFixture, INPUT_WORKLOADS } from "../src/input-workloads";
import { PtyInputDriver } from "./pty-input-driver";
import { collectBrowserErrors } from "./browser-errors";
import { attachReport } from "./report";

const profile = process.env.WTERM_PTY_INPUT_PROFILE ?? "smoke";
if (!["smoke", "measure"].includes(profile))
  throw new Error("WTERM_PTY_INPUT_PROFILE must be smoke or measure");
const probes = profile === "measure" ? 256 : 16;
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  files: Object.fromEntries(
    [
      "../pty-input-fixture.mjs",
      "../pty-input-server.mjs",
      "../../../examples/local/lib/pty-output-queue.mts",
      "../src/pty-input-main.ts",
      "../src/echo-probe.ts",
      "../src/input-workloads.ts",
      "./pty-input-driver.ts",
      "../../../packages/@wterm/ghostty/wasm/ghostty-vt.wasm",
    ].map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(new URL(file, import.meta.url)))
        .digest("hex"),
    ]),
  ),
};

for (const sessions of [1, 8])
  for (const workload of INPUT_WORKLOADS) {
    test(`ghostty ${sessions} PTYs ${workload} input`, async ({
      page,
      browser,
    }, testInfo) => {
      const driver = new PtyInputDriver(page);
      await driver.install();
      const errors = collectBrowserErrors(page);
      const host = await (await page.request.get("/health")).json();
      const chunks = inputFixture(workload);
      const hash = createHash("sha256");
      chunks.forEach((chunk) => hash.update(chunk));
      let measurement;
      try {
        expect(host).toMatchObject({ activePtys: 0, serving: "production" });
        await page.goto(
          `/pty-input.html?sessions=${sessions}&workload=${workload}`,
        );
        await expect(page.locator("#status")).toHaveText("Ready");
        expect(
          (await (await page.request.get("/health")).json()).activePtys,
        ).toBe(sessions);
        await page.evaluate((count) => window.ptyInput.start(count), probes);
        for (let i = 0; i < probes; i++)
          await driver.press(String.fromCharCode(97 + (i % 26)));
        measurement = await page.evaluate(() => window.ptyInput.finish());
        expect(measurement.complete, measurement.error ?? "").toBe(true);
        expect(driver.report()).toMatchObject({
          started: probes,
          completed: probes,
          error: null,
        });
        expect(measurement.probes).toMatchObject({
          started: probes,
          completed: probes,
          pending: false,
        });
        const timings = [
          driver.report().requestToDOMReportMs,
          driver.report().requestToFrameReportMs,
          measurement.probes!.keyDispatchToDOMMs,
          measurement.probes!.keyDispatchToFrameMs,
        ];
        for (const timing of timings) {
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
        // Browser clocks may quantize durations; allow two ms for rounding.
        expect(
          driver.report().requestToFrameReportMs.mean! + 2,
        ).toBeGreaterThanOrEqual(
          measurement.probes!.keyDispatchToFrameMs.mean!,
        );
        expect(new Set(measurement.sessions.map((s) => s.pid)).size).toBe(
          sessions,
        );
        for (const [i, session] of measurement.sessions.entries()) {
          expect(session.pid).toBeGreaterThan(0);
          expect(session.flow).toMatchObject({
            exitCode: 0,
            sent: session.receivedBytes,
            acknowledged: session.receivedBytes,
          });
          expect(session.flow!.maxOutstandingBytes).toBeLessThanOrEqual(65536);
          expect(session.flow!.outputMessages).toBe(session.receivedMessages);
          expect(session.flow!.ptyReads).toBeGreaterThan(0);
          expect(session.flow!.maxPendingBytes).toBeLessThanOrEqual(
            1024 * 1024,
          );
          const summary = session.summary.match(
            /^done writes=(\d+) bytes=(\d+) probes=(\d+)$/,
          );
          expect(summary).not.toBeNull();
          const writes = Number(summary![1]);
          const bytes = Number(summary![2]);
          const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
          const expected = chunks.length
            ? Math.floor(writes / chunks.length) * total +
              chunks
                .slice(0, writes % chunks.length)
                .reduce((n, c) => n + c.length, 0)
            : 0;
          expect(bytes).toBe(expected);
          expect(Number(summary![3])).toBe(i === 0 ? probes : 0);
          if (workload === "idle") expect(writes).toBe(0);
          else {
            expect(writes).toBeGreaterThan(0);
            expect(session.receivedMiBPerSecond).toBeGreaterThan(0);
          }
          if (i) expect(session.renderMs.count).toBe(0);
          else {
            expect(session.renderMs.count).toBeGreaterThan(0);
            expect(session.echo).toBe(
              `echo ${String(probes).padStart(4, "0")}: ${String.fromCharCode(97 + ((probes - 1) % 26))}`,
            );
          }
        }
        for (const snapshot of Object.values(measurement.resources))
          for (const session of snapshot!) {
            expect(session.wasmLinearMemoryBytes).toBeGreaterThan(0);
            expect(session.mountedRows).toBeLessThan(200);
          }
        expect(errors.errors).toEqual([]);
      } finally {
        if (!page.isClosed()) {
          measurement ??= await page
            .evaluate(() => {
              window.ptyInput?.abort("Automation ended before completion");
              return window.ptyInput?.report() ?? null;
            })
            .catch(() => null);
        }
        // Preserve partial measurements even when the cleanup assertion fails.
        await attachReport(testInfo, "pty-input.json", {
          profile,
          probes,
          sessions,
          workload,
          source,
          host,
          fixture: {
            sha256: hash.digest("hex"),
            chunkBytes: chunks.map((c) => c.length),
            intervalMs: 16,
          },
          browser: browser.version(),
          headless: testInfo.project.use.headless ?? true,
          repeat: testInfo.repeatEachIndex,
          browserErrors: errors,
          driver: driver.report(),
          measurement,
        });
        if (!page.isClosed()) await page.goto("about:blank");
        await expect
          .poll(
            async () =>
              (await (await page.request.get("/health")).json()).activePtys,
          )
          .toBe(0);
      }
    });
  }

test("driver timing includes a blocked browser input queue", async ({
  page,
}) => {
  const driver = new PtyInputDriver(page);
  await driver.install();
  let willBlock!: () => void;
  const blocking = new Promise<void>((resolve) => (willBlock = resolve));
  await page.exposeBinding("ptyInputWillBlock", () => willBlock());
  await page.goto("/pty-input.html?workload=idle");
  await expect(page.locator("#status")).toHaveText("Ready");
  await page.evaluate(() => window.ptyInput.start(1));
  const busy = page.evaluate(() => {
    void window.ptyInputWillBlock!();
    const end = performance.now() + 750;
    while (performance.now() < end) {
      /* Deliberately block input dispatch. */
    }
  });
  await blocking;
  await driver.press("a");
  await busy;
  const result = await page.evaluate(() => window.ptyInput.finish());
  expect(result.complete).toBe(true);
  expect(
    driver.report().requestToFrameReportMs.mean! -
      result.probes!.keyDispatchToFrameMs.mean!,
  ).toBeGreaterThan(250);
  await page.goto("about:blank");
  await expect
    .poll(
      async () => (await (await page.request.get("/health")).json()).activePtys,
    )
    .toBe(0);
});

test("missing DOM echo fails and releases every PTY", async ({ page }) => {
  const driver = new PtyInputDriver(page);
  await driver.install();
  await page.goto("/pty-input.html?sessions=8&workload=ansi");
  await expect(page.locator("#status")).toHaveText("Ready");
  await page.evaluate(async () => {
    await window.ptyInput.start(1);
    window.ptyInput.pause(true);
  });
  await expect(driver.press("a")).rejects.toThrow(/within 5 seconds/);
  await page.evaluate(() => window.ptyInput.abort("Missing echo"));
  const result = await page.evaluate(() => window.ptyInput.report());
  expect(result.complete).toBe(false);
  expect(result.probes!.completed).toBe(0);
  expect(driver.report().completed).toBe(0);
  await page.goto("about:blank");
  await expect
    .poll(
      async () => (await (await page.request.get("/health")).json()).activePtys,
    )
    .toBe(0);
});
