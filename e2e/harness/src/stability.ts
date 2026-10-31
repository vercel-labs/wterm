import type { TerminalCore } from "@wterm/core";
import { Renderer, type WTerm } from "@wterm/dom";
import { Samples } from "./metrics";
import {
  STABILITY_BATCH_ROWS,
  STABILITY_COLS,
  STABILITY_ROWS,
  STABILITY_MAX_BYTES,
  STABILITY_SAMPLE_LIMIT,
  STABILITY_WARMUP_BYTES,
  STABILITY_PROFILES,
  stabilityBatch,
  stabilityLine,
  type StabilityProfile,
} from "./stability-workload";

function rowText(core: TerminalCore, row: number) {
  let text = "";
  for (let col = 0; col < STABILITY_COLS; col++) {
    const cell = core.getCell(row, col);
    if (cell.width !== 0)
      text += cell.chars ?? String.fromCodePoint(cell.char || 32);
  }
  return text.trimEnd();
}
function resourceSample(
  terminal: WTerm,
  core: TerminalCore,
  memory: WebAssembly.Memory,
) {
  return {
    wasmBytes: memory.buffer.byteLength,
    jsHeapUsedBytes:
      (performance as Performance & { memory?: { usedJSHeapSize: number } })
        .memory?.usedJSHeapSize ?? null,
    elements: terminal.element.querySelectorAll("*").length,
    mountedRows: terminal.element.querySelectorAll(".term-row").length,
    historyRows: core.getScrollbackCount(),
    discardedRows: core.getScrollbackDiscardedCount?.() ?? null,
  };
}
export interface StabilityReport {
  schemaVersion: 1;
  profile: StabilityProfile;
  complete: boolean;
  error: string | null;
  phase: "warmup" | "measure" | "finished";
  startedAt: string;
  warmupMs: number | null;
  elapsedMs: number;
  measuredMs: number;
  outputBytes: number;
  measuredBytes: number;
  verifiedRows: number;
  verifiedFrames: number;
  measuredFrames: number;
  firstMeasuredRow: number | null;
  lastVerifiedRow: number | null;
  frameIntervals: ReturnType<Samples["report"]>;
  taskDelays: ReturnType<Samples["report"]>;
  samples: (ReturnType<typeof resourceSample> & {
    atMs: number;
    phase: "warmup" | "measure" | "finished";
    outputBytes: number;
  })[];
  environment: {
    userAgent: string;
    devicePixelRatio: number;
    viewport: { width: number; height: number };
    font: string;
    rowHeight: string;
    cellWidth: string;
  };
}

export function startStability(
  terminal: WTerm,
  core: TerminalCore,
  memory: WebAssembly.Memory,
  profile: StabilityProfile,
) {
  if (profile !== "smoke" && profile !== "soak")
    throw new Error("Unknown stability profile");
  const spec = STABILITY_PROFILES[profile];
  const style = getComputedStyle(terminal.element);
  const report: StabilityReport = {
    schemaVersion: 1,
    profile,
    complete: false,
    error: null,
    phase: "warmup",
    startedAt: new Date().toISOString(),
    warmupMs: null,
    elapsedMs: 0,
    measuredMs: 0,
    outputBytes: 0,
    measuredBytes: 0,
    verifiedRows: 0,
    verifiedFrames: 0,
    measuredFrames: 0,
    firstMeasuredRow: null,
    lastVerifiedRow: null,
    frameIntervals: new Samples().report(),
    taskDelays: new Samples().report(),
    samples: [],
    environment: {
      userAgent: navigator.userAgent,
      devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`,
      rowHeight: style.getPropertyValue("--term-row-height"),
      cellWidth: style.getPropertyValue("--term-cell-width"),
    },
  };
  const originalRender = Renderer.prototype.render;
  const frames = new Samples(4096),
    delays = new Samples(4096);
  const started = performance.now();
  let measuredStart: number | null = null;
  let baselineBytes = 0,
    baselineFrames = 0,
    baselineWasm = 0;
  let nextRow = 0,
    firstVisibleRow = 0;
  let latestLines: string[] = [];
  let lastPaint = started,
    lastVerifiedPaint = -1,
    lastFrame = started;
  let lastSample = started,
    due = started;
  let timer = 0,
    animation = 0,
    watchdog = 0;
  let stopped = false,
    finishing = false;
  let resolve!: (value: StabilityReport) => void;
  const done = new Promise<StabilityReport>((value) => {
    resolve = value;
  });
  const sample = () => {
    if (report.samples.length >= STABILITY_SAMPLE_LIMIT)
      throw new Error("Resource sample limit exceeded");
    const value = resourceSample(terminal, core, memory);
    report.samples.push({
      ...value,
      atMs: performance.now() - started,
      phase: report.phase,
      outputBytes: report.outputBytes,
    });
    lastSample = performance.now();
    if (value.mountedRows >= 200)
      throw new Error("Mounted terminal rows exceeded the bound");
    if (measuredStart !== null && value.wasmBytes > baselineWasm)
      throw new Error("WASM memory grew after warmup");
  };
  const update = () => {
    report.elapsedMs = performance.now() - started;
    report.measuredMs =
      measuredStart === null ? 0 : performance.now() - measuredStart;
    report.measuredBytes =
      measuredStart === null ? 0 : report.outputBytes - baselineBytes;
    report.measuredFrames =
      measuredStart === null ? 0 : report.verifiedFrames - baselineFrames;
    report.frameIntervals = frames.report();
    report.taskDelays = delays.report();
  };
  const finish = (error: string | null) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    clearInterval(watchdog);
    cancelAnimationFrame(animation);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pagehide);
    window.removeEventListener("error", pageError);
    window.removeEventListener("unhandledrejection", rejection);
    Renderer.prototype.render = originalRender;
    update();
    report.phase = "finished";
    try {
      sample();
    } catch (cause) {
      error ??= cause instanceof Error ? cause.message : String(cause);
    }
    report.complete = error === null;
    report.error = error;
    resolve(report);
  };
  const fail = (cause: unknown) =>
    finish(cause instanceof Error ? cause.message : String(cause));
  const visibility = () => {
    if (document.hidden) finish("Page became hidden");
  };
  const pagehide = () => finish("Page closed");
  const pageError = (event: ErrorEvent) =>
    finish(`Page error: ${event.message}`);
  const rejection = (event: PromiseRejectionEvent) =>
    finish(`Unhandled rejection: ${String(event.reason)}`);

  Renderer.prototype.render = function (...args) {
    const result = originalRender.apply(this, args);
    if (stopped || !nextRow) return result;
    try {
      const rows = terminal.element.querySelectorAll<HTMLElement>(
        ".term-row:not(.term-scrollback-row)",
      );
      if (rows.length !== STABILITY_ROWS)
        throw new Error("Rendered grid has incorrect dimensions");
      for (let offset = 0; offset < latestLines.length; offset++) {
        if (
          rows[firstVisibleRow + offset].textContent?.trimEnd() !==
          latestLines[offset]
        )
          throw new Error(
            `Rendered text differs at record ${nextRow - STABILITY_BATCH_ROWS + offset}`,
          );
      }
      report.verifiedFrames++;
      lastVerifiedPaint = nextRow;
      lastPaint = performance.now();
    } catch (error) {
      fail(error);
    }
    return result;
  };

  const produce = () => {
    if (stopped) return;
    const now = performance.now();
    if (measuredStart !== null) delays.add(Math.max(0, now - due));
    try {
      if (document.hidden) throw new Error("Page became hidden");
      const bytes = stabilityBatch(nextRow);
      if (report.outputBytes + bytes.length > STABILITY_MAX_BYTES)
        throw new Error("Output byte limit exceeded");
      latestLines = Array.from({ length: STABILITY_BATCH_ROWS }, (_, offset) =>
        stabilityLine(nextRow + offset),
      );
      terminal.write(bytes);
      report.outputBytes += bytes.length;
      firstVisibleRow = core.getCursor().row - STABILITY_BATCH_ROWS;
      if (
        firstVisibleRow < 0 ||
        core.getCols() !== STABILITY_COLS ||
        core.getRows() !== STABILITY_ROWS
      )
        throw new Error(
          "Terminal cursor or dimensions differ from the workload",
        );
      for (let offset = 0; offset < latestLines.length; offset++) {
        if (rowText(core, firstVisibleRow + offset) !== latestLines[offset])
          throw new Error(`Parsed text differs at record ${nextRow + offset}`);
      }
      nextRow += STABILITY_BATCH_ROWS;
      report.verifiedRows = nextRow;
      report.lastVerifiedRow = nextRow - 1;
      const discarded = core.getScrollbackDiscardedCount?.();
      if (
        measuredStart === null &&
        report.outputBytes >= STABILITY_WARMUP_BYTES &&
        discarded &&
        report.verifiedFrames > 0
      ) {
        measuredStart = performance.now();
        baselineBytes = report.outputBytes;
        baselineFrames = report.verifiedFrames;
        baselineWasm = memory.buffer.byteLength;
        report.warmupMs = measuredStart - started;
        report.firstMeasuredRow = nextRow;
        report.phase = "measure";
        lastFrame = measuredStart;
        sample();
      } else if (performance.now() - lastSample >= spec.sampleIntervalMs)
        sample();
      if (
        measuredStart !== null &&
        performance.now() - measuredStart >= spec.durationMs &&
        report.outputBytes - baselineBytes >= spec.minimumBytes
      ) {
        finishing = true;
      } else {
        due = performance.now();
        timer = window.setTimeout(produce, 0);
      }
    } catch (error) {
      fail(error);
    }
  };
  let finalFrames = 0;
  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    if (measuredStart !== null) frames.add(now - lastFrame);
    lastFrame = now;
    if (finishing && lastVerifiedPaint === nextRow && ++finalFrames >= 2)
      finish(null);
    else animation = requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("error", pageError);
  window.addEventListener("unhandledrejection", rejection);
  watchdog = window.setInterval(() => {
    const now = performance.now();
    if (now - started > spec.durationMs + 120000)
      finish("Run deadline exceeded");
    else if (now - lastPaint > 5000)
      finish("Terminal rendering stalled for five seconds");
    else if (measuredStart === null && now - started > 30000)
      finish("Warmup did not reach history pruning within 30 seconds");
  }, 250);
  try {
    if (document.hidden) throw new Error("Page is hidden");
    sample();
    animation = requestAnimationFrame(tick);
    due = performance.now();
    timer = window.setTimeout(produce, 0);
  } catch (error) {
    fail(error);
  }
  return {
    done,
    abort: () => finish("Cancelled"),
    report: () => {
      if (!stopped) update();
      return report;
    },
    running: () => !stopped,
  };
}
