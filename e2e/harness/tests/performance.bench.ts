import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  ROWS,
  HISTORY_LINES,
  HISTORY_ROWS,
  SCROLL_FIXTURES,
  REDRAW_FIXTURES,
  historyOutput,
  redrawOutput,
  rowText,
  scrollRow,
  type Workload,
} from "../src/performance-workloads";
import { attachReport } from "./report";

const sha256 = (value: string | Uint8Array) =>
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
const profile = process.env.WTERM_PERFORMANCE_PROFILE ?? "smoke";
if (profile !== "smoke" && profile !== "stress")
  throw new Error("WTERM_PERFORMANCE_PROFILE must be smoke or stress");
const frames = profile === "stress" ? 180 : 60;

async function open(page: Page, core: string) {
  await page.goto(`/performance.html?core=${core}`);
  await expect(page.locator("#status")).toHaveText("Ready");
  const host = await (await page.request.get("/health")).json();
  expect(host.activePtys).toBe(0);
  expect(host.serving).toBe("production");
  return host;
}

async function report(page: Page, testInfo: TestInfo, data: object) {
  await attachReport(testInfo, "performance.json", {
    source,
    profile,
    browser: page.context().browser()!.version(),
    project: testInfo.project.name,
    repeat: testInfo.repeatEachIndex,
    ...data,
  });
}

function capacity(sample: {
  wasmLinearMemoryBytes: number[];
  mountedRows: number;
}) {
  for (const bytes of sample.wasmLinearMemoryBytes) {
    expect(bytes).toBeGreaterThan(0);
    expect(bytes % 65536).toBe(0);
  }
  expect(sample.mountedRows).toBeLessThan(200);
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core} downloads the embedded binary only when selected`, async ({
    page,
  }) => {
    const binary = readFileSync(
      new URL("../../../packages/@wterm/core/wasm/wterm.wasm", import.meta.url),
    ).toString("base64");
    const scripts: Promise<string>[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "script")
        scripts.push(response.text());
    });
    await open(page, core);
    const embeddedScripts = async () =>
      (await Promise.all(scripts)).filter((body) => body.includes(binary));
    expect(await embeddedScripts()).toHaveLength(0);
    const measurement = await page.evaluate(() =>
      window.terminalPerformance.startup(8, true),
    );
    expect(measurement.independentMemories).toBe(8);
    expect(measurement.instances.map(({ char }) => char)).toEqual(
      Array.from({ length: 8 }, (_, i) => 65 + i),
    );
    expect(await embeddedScripts()).toHaveLength(core === "builtin" ? 1 : 0);
  });

  for (const [count, concurrent] of [
    [1, false],
    [8, false],
    [8, true],
  ] as const) {
    test(`${core} initialize ${count} cores ${concurrent ? "concurrently" : "sequentially"}`, async ({
      page,
    }, testInfo) => {
      const host = await open(page, core);
      const measurement = await page.evaluate(
        ({ count, concurrent }) =>
          window.terminalPerformance.startup(count, concurrent),
        { count, concurrent },
      );
      await report(page, testInfo, {
        core,
        host,
        workload: { kind: "startup", count, concurrent },
        measurement,
      });
      expect(Number.isFinite(measurement.initializedMs)).toBe(true);
      expect(measurement.initializedMs).toBeGreaterThanOrEqual(0);
      expect(measurement.compilations + measurement.streamingCompilations).toBe(
        1,
      );
      expect(measurement.wasmRequests).toHaveLength(core === "ghostty" ? 1 : 0);
      expect(measurement.independentMemories).toBe(count);
      expect(measurement.instances.map(({ char }) => char)).toEqual(
        Array.from({ length: count }, (_, i) => 65 + i),
      );
      capacity({
        wasmLinearMemoryBytes: measurement.instances.map(({ bytes }) => bytes),
        mountedRows: 0,
      });
    });
  }

  const workloads: Workload[] = [
    ...SCROLL_FIXTURES.flatMap((fixture) =>
      ([1, 15] as const).map((step) => ({
        kind: "scroll" as const,
        fixture,
        step,
        frames,
      })),
    ),
    ...REDRAW_FIXTURES.flatMap((fixture) =>
      [false, true].map((replacement) => ({
        kind: "redraw" as const,
        fixture,
        replacement,
        frames,
      })),
    ),
  ];
  for (const workload of workloads) {
    const variation =
      workload.kind === "scroll"
        ? `step ${workload.step}`
        : workload.replacement
          ? "replacement"
          : "partial";
    test(`${core} ${workload.kind} ${workload.fixture} ${variation}`, async ({
      page,
      browserName,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const host = await open(page, core);
      const hash = createHash("sha256").update(JSON.stringify(workload));
      if (workload.kind === "scroll")
        hash.update(historyOutput(workload.fixture));
      else
        for (let i = 0; i < frames + 10; i++)
          hash.update(redrawOutput(workload.fixture, i, workload.replacement));
      const prepared = await page.evaluate(
        (workload) => window.terminalPerformance.prepare(workload),
        workload,
      );
      expect(prepared.resources.retainedHistoryRows).toEqual([
        workload.kind === "scroll" ? HISTORY_ROWS : 0,
      ]);
      const session =
        browserName === "chromium"
          ? await page.context().newCDPSession(page)
          : null;
      await session?.send("Performance.enable");
      const metrics = async () =>
        session
          ? Object.fromEntries(
              (await session.send("Performance.getMetrics")).metrics.map(
                ({ name, value }) => [name, value],
              ),
            )
          : null;
      try {
        const before = await metrics();
        const measurement = await page.evaluate(() =>
          window.terminalPerformance.run(),
        );
        const after = await metrics();
        const mainThread =
          before && after
            ? {
                taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
                layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
                styleMs:
                  (after.RecalcStyleDuration - before.RecalcStyleDuration) *
                  1000,
              }
            : null;
        const final = await page.evaluate(() =>
          window.terminalPerformance.inspect(),
        );
        await report(page, testInfo, {
          core,
          host,
          workload,
          fixtureSha256: hash.digest("hex"),
          prepared,
          measurement,
          mainThread,
          final,
        });
        expect(errors).toEqual([]);
        capacity(final.resources);
        expect(final.resources.retainedHistoryRows).toEqual(
          prepared.resources.retainedHistoryRows,
        );
        expect(measurement.renderMs.count).toBeGreaterThan(0);
        expect(measurement.frameIntervalMs.count).toBe(frames);
        for (const timing of [
          measurement.renderMs,
          measurement.frameIntervalMs,
        ]) {
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
        if (workload.kind === "scroll") {
          expect(final.scrollRow).toBeCloseTo(
            scrollRow(frames, workload.step),
            1,
          );
          expect(final.historyRows.length).toBeGreaterThan(ROWS);
          for (const row of final.historyRows)
            expect(row.text).toBe(
              rowText(workload.fixture, row.index).trimEnd(),
            );
          expect(
            final.historyRows.some(
              ({ index }) => index === scrollRow(frames, workload.step),
            ),
          ).toBe(true);
          expect(final.liveRows).toEqual([
            ...Array.from({ length: ROWS - 1 }, (_, i) =>
              rowText(workload.fixture, HISTORY_LINES - ROWS + 1 + i).trimEnd(),
            ),
            "",
          ]);
        } else {
          const last = frames + 9;
          expect(final.liveRows).toEqual(
            Array(ROWS).fill(
              rowText(
                workload.fixture,
                last,
                workload.replacement && last % 2 === 1,
              ).trimEnd(),
            ),
          );
          expect(measurement.writeMs.count).toBe(frames);
        }
      } finally {
        await session?.detach();
      }
    });
  }

  test(`${core} memory through alternate screen and history`, async ({
    page,
  }, testInfo) => {
    const host = await open(page, core);
    const measurement = await page.evaluate(() =>
      window.terminalPerformance.allocations(),
    );
    await report(page, testInfo, {
      core,
      host,
      workload: { kind: "memory" },
      fixtureSha256: sha256(historyOutput("unicode")),
      measurement,
    });
    expect(measurement.samples.map(({ stage }) => stage)).toEqual([
      "initial",
      "alternate",
      "restored",
      "history",
      "cleared",
    ]);
    expect(
      measurement.samples.map(
        ({ retainedHistoryRows }) => retainedHistoryRows[0],
      ),
    ).toEqual([0, 0, 0, HISTORY_ROWS, 0]);
    for (let i = 0; i < measurement.samples.length; i++) {
      capacity(measurement.samples[i]);
      if (i)
        expect(
          measurement.samples[i].wasmLinearMemoryBytes[0],
        ).toBeGreaterThanOrEqual(
          measurement.samples[i - 1].wasmLinearMemoryBytes[0],
        );
    }
    expect(measurement.history!.liveRows).toEqual([
      ...Array.from({ length: ROWS - 1 }, (_, i) =>
        rowText("unicode", HISTORY_LINES - ROWS + 1 + i).trimEnd(),
      ),
      "",
    ]);
    expect(measurement.final.liveRows).toEqual(Array(ROWS).fill(""));
  });
}
