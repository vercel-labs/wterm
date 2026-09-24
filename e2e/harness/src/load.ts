import type { TerminalCore } from "@wterm/core";
import { Renderer, type WTerm } from "@wterm/dom";
import { Samples } from "./metrics";
import { describeLoad, loadChunks, type LoadWorkload } from "./load-workloads";

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const task = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function resources(
  element: HTMLElement,
  core: TerminalCore,
  memory: WebAssembly.Memory,
) {
  const heap = (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory;
  return {
    wasmLinearMemoryBytes: memory.buffer.byteLength,
    jsHeapUsedBytes: heap?.usedJSHeapSize ?? null,
    domElements: element.querySelectorAll("*").length,
    mountedRows: element.querySelectorAll(".term-row").length,
    retainedHistoryRows: core.getScrollbackCount(),
  };
}

export interface LoadReport {
  schemaVersion: number;
  source: "synthetic-output";
  complete: boolean;
  error: string | null;
  workload: ReturnType<typeof describeLoad>;
  outputBytes: number;
  chunks: number;
  elapsedMs: number;
  deliveredMiBPerSecond: number;
  environment: {
    userAgent: string;
    hardwareConcurrency: number;
    devicePixelRatio: number;
    viewport: { width: number; height: number };
    fontFamily: string;
    fontSize: string;
    cellWidth: string;
    rowHeight: string;
    hidden: boolean;
  };
  timings: Record<
    "writeMs" | "coreWriteMs" | "renderMs" | "frameIntervalMs" | "taskDelayMs",
    ReturnType<Samples["report"]>
  > & {
    longTaskMs: ReturnType<Samples["report"]> | null;
  };
  resources: (ReturnType<typeof resources> & {
    atMs: number;
    outputBytes: number;
  })[];
}

export async function runLoad(
  terminal: WTerm,
  core: TerminalCore,
  memory: WebAssembly.Memory,
  workload: LoadWorkload,
  targetBytes: number,
  saveReport: (report: LoadReport) => void,
): Promise<LoadReport> {
  const spec = describeLoad(workload, targetBytes);
  // A small untimed write warms the render path without populating history.
  terminal.write("warmup\r\x1b[2K\x1b[?25l");
  await frame();
  await frame();
  if (document.visibilityState !== "visible")
    throw new Error("Benchmark page must be visible");
  let hidden = false;
  const onVisibility = () => {
    hidden ||= document.visibilityState !== "visible";
  };
  document.addEventListener("visibilitychange", onVisibility);

  const writeMs = new Samples(16384);
  const coreWriteMs = new Samples(16384);
  const renderMs = new Samples(16384);
  const frameIntervalMs = new Samples(16384);
  const taskDelayMs = new Samples(16384);
  const longTaskMs = new Samples(16384);
  const memorySamples: (ReturnType<typeof resources> & {
    atMs: number;
    outputBytes: number;
  })[] = [];
  const originalRender = Renderer.prototype.render;
  const originalWrite = core.writeRaw;
  let frameId = 0;
  let timer = 0;
  let previousFrame: number | undefined;
  let outputBytes = 0;
  let chunks = 0;
  let complete = false;
  let error: string | null = null;
  let report: LoadReport;
  let observer: PerformanceObserver | undefined;
  const longTasksSupported =
    PerformanceObserver.supportedEntryTypes.includes("longtask");
  let endedAt = Infinity;
  const startedAt = performance.now();
  const collectLongTasks = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      if (entry.startTime >= startedAt && entry.startTime < endedAt)
        longTaskMs.add(entry.duration);
    }
  };
  const sampleResources = () =>
    memorySamples.push({
      atMs: performance.now() - startedAt,
      outputBytes,
      ...resources(terminal.element, core, memory),
    });
  Renderer.prototype.render = function (...args) {
    const start = performance.now();
    try {
      return originalRender.apply(this, args);
    } finally {
      renderMs.add(performance.now() - start);
    }
  };
  core.writeRaw = function (...args) {
    const start = performance.now();
    try {
      return originalWrite.apply(this, args);
    } finally {
      coreWriteMs.add(performance.now() - start);
    }
  };
  const onFrame = () => {
    const now = performance.now();
    if (previousFrame !== undefined) frameIntervalMs.add(now - previousFrame);
    previousFrame = now;
    frameId = requestAnimationFrame(onFrame);
  };
  const scheduleTaskProbe = () => {
    const due = performance.now() + 16;
    timer = window.setTimeout(() => {
      taskDelayMs.add(Math.max(0, performance.now() - due));
      scheduleTaskProbe();
    }, 16);
  };
  try {
    if (longTasksSupported) {
      observer = new PerformanceObserver((list) =>
        collectLongTasks(list.getEntries()),
      );
      observer.observe({ type: "longtask" });
    }
    sampleResources();
    frameId = requestAnimationFrame(onFrame);
    scheduleTaskProbe();
    for (const bytes of loadChunks(spec)) {
      const start = performance.now();
      terminal.write(bytes);
      writeMs.add(performance.now() - start);
      outputBytes += bytes.byteLength;
      chunks++;
      // Feed one bounded chunk per timer task. This is a fixed producer policy,
      // not a throughput limit or an implementation of transport backpressure.
      if (chunks % 64 === 0) sampleResources();
      await task();
    }
    // Let the final scheduled render and a subsequent frame opportunity finish.
    await frame();
    await frame();
    if (hidden) throw new Error("Benchmark page became hidden");
    complete = true;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    throw cause;
  } finally {
    endedAt = performance.now();
    cancelAnimationFrame(frameId);
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    if (observer) {
      collectLongTasks(observer.takeRecords());
      observer.disconnect();
    }
    Renderer.prototype.render = originalRender;
    core.writeRaw = originalWrite;
    sampleResources();
    const style = getComputedStyle(terminal.element);
    report = {
      schemaVersion: 1,
      source: "synthetic-output" as const,
      complete,
      error,
      workload: spec,
      outputBytes,
      chunks,
      elapsedMs: endedAt - startedAt,
      deliveredMiBPerSecond:
        outputBytes / (1024 * 1024) / ((endedAt - startedAt) / 1000),
      environment: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        devicePixelRatio,
        viewport: { width: innerWidth, height: innerHeight },
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        cellWidth: style.getPropertyValue("--term-cell-width"),
        rowHeight: style.getPropertyValue("--term-row-height"),
        hidden,
      },
      timings: {
        writeMs: writeMs.report(),
        coreWriteMs: coreWriteMs.report(),
        renderMs: renderMs.report(),
        frameIntervalMs: frameIntervalMs.report(),
        taskDelayMs: taskDelayMs.report(),
        longTaskMs: longTasksSupported ? longTaskMs.report() : null,
      },
      resources: memorySamples,
    };
    saveReport(report);
  }
  // The saved report is also returned so automation can assert its contents.
  // This branch is reached only on success.
  return report;
}
