import { WasmBridge, type TerminalCore } from "@wterm/core";
import { Renderer, WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasm from "@wterm/ghostty/ghostty-vt.wasm?url";
import { Samples } from "./metrics";
import {
  COLS,
  ROWS,
  historyOutput,
  redrawOutput,
  scrollRow,
  type Workload,
} from "./performance-workloads";
import "@wterm/dom/css";
import "./style.css";

const element = document.querySelector<HTMLElement>("#terminal")!;
const status = document.querySelector<HTMLElement>("#status")!;
const coreName = new URLSearchParams(location.search).get("core");
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await frame();
  await frame();
};
let terminal: WTerm | undefined;
const cores: TerminalCore[] = [];
let workload: Workload | undefined;
let updates: Uint8Array[] = [];
let rowHeight = 0;
let used = false;

function memory(core: TerminalCore): WebAssembly.Memory {
  // Benchmark-only access; fail if an adapter changes its memory layout.
  const value =
    core instanceof WasmBridge
      ? (core as unknown as { memory: WebAssembly.Memory }).memory
      : (
          core as unknown as {
            wasm: { exports: { memory: WebAssembly.Memory } };
          }
        ).wasm.exports.memory;
  if (!(value instanceof WebAssembly.Memory))
    throw new Error("Missing WASM linear memory");
  return value;
}

function resources() {
  return {
    wasmLinearMemoryBytes: cores.map((core) => memory(core).buffer.byteLength),
    retainedHistoryRows: cores.map((core) => core.getScrollbackCount()),
    mountedRows: element.querySelectorAll(".term-row").length,
    domElements: element.querySelectorAll("*").length,
  };
}

function environment() {
  const style = getComputedStyle(element);
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    cellWidth: style.getPropertyValue("--term-cell-width"),
    rowHeight,
    cols: COLS,
    rows: ROWS,
  };
}

function claim() {
  if (used) throw new Error("Reload before running another workload");
  used = true;
  status.textContent = "Running";
}

async function load() {
  const core =
    coreName === "builtin"
      ? await WasmBridge.load()
      : await GhosttyCore.load({
          wasmPath: ghosttyWasm,
          scrollbackLimit: 8 * 1024 * 1024,
        });
  cores.push(core);
  return core;
}

async function init() {
  const core = await load();
  terminal = new WTerm(element, {
    core,
    cols: COLS,
    rows: ROWS,
    autoResize: false,
    cursorBlink: false,
    onData: () => {},
  });
  await terminal.init();
  terminal.write("\x1b[?25l");
  await settle();
  rowHeight = element
    .querySelector(".term-row")!
    .getBoundingClientRect().height;
}

function scrollTo(row: number) {
  element.scrollTop = row * rowHeight;
  element.dispatchEvent(new Event("scroll"));
}

const api = {
  async startup(count: 1 | 8, concurrent: boolean) {
    claim();
    let compilations = 0;
    let streamingCompilations = 0;
    const compile = WebAssembly.compile;
    const stream = WebAssembly.compileStreaming;
    WebAssembly.compile = (...args) => {
      compilations++;
      return compile(...args);
    };
    WebAssembly.compileStreaming = (...args) => {
      streamingCompilations++;
      return stream(...args);
    };
    try {
      const started = performance.now();
      const create = async (index: number) => {
        const core = await load();
        core.init(COLS, ROWS);
        core.writeString(String.fromCharCode(65 + index));
        // Include lazy render-state allocations in the initialized-core boundary.
        const char = core.getCell(0, 0).char;
        return { index, char, bytes: memory(core).buffer.byteLength };
      };
      const instances = [];
      if (concurrent) {
        instances.push(
          ...(await Promise.all(
            Array.from({ length: count }, (_, i) => create(i)),
          )),
        );
      } else {
        for (let i = 0; i < count; i++) instances.push(await create(i));
      }
      const initializedMs = performance.now() - started;
      return {
        initializedMs,
        instances,
        independentMemories: new Set(cores.map(memory)).size,
        compilations,
        streamingCompilations,
        wasmRequests: performance
          .getEntriesByType("resource")
          .filter(
            (entry) => entry.name === new URL(ghosttyWasm, location.href).href,
          )
          .map((entry) => {
            const resource = entry as PerformanceResourceTiming;
            return {
              durationMs: resource.duration,
              transferBytes: resource.transferSize,
              encodedBytes: resource.encodedBodySize,
            };
          }),
        environment: environment(),
      };
    } finally {
      WebAssembly.compile = compile;
      WebAssembly.compileStreaming = stream;
      status.textContent = "Complete";
    }
  },
  async prepare(spec: Workload) {
    claim();
    await init();
    workload = spec;
    const encoder = new TextEncoder();
    if (spec.kind === "scroll") {
      terminal!.write(encoder.encode(historyOutput(spec.fixture)));
      await settle();
      for (let i = 1; i <= 10; i++) {
        scrollTo(scrollRow(i, spec.step));
        await frame();
      }
      scrollTo(scrollRow(0, spec.step));
    } else {
      for (let i = 0; i < 10; i++) {
        terminal!.write(redrawOutput(spec.fixture, i, spec.replacement));
        await frame();
      }
      // Encode before timing so string construction does not mask renderer work.
      updates = Array.from({ length: spec.frames }, (_, i) =>
        encoder.encode(redrawOutput(spec.fixture, i + 10, spec.replacement)),
      );
    }
    await settle();
    return { environment: environment(), resources: resources() };
  },
  async run() {
    if (!workload) throw new Error("Prepare a workload first");
    if (document.visibilityState !== "visible")
      throw new Error("Hidden benchmark page");
    let hidden = false;
    const onVisibility = () => {
      hidden ||= document.visibilityState !== "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);
    const renderMs = new Samples(4096);
    const frameIntervalMs = new Samples(4096);
    const writeMs = new Samples(4096);
    const originalRender = Renderer.prototype.render;
    Renderer.prototype.render = function (...args) {
      const start = performance.now();
      try {
        return originalRender.apply(this, args);
      } finally {
        renderMs.add(performance.now() - start);
      }
    };
    try {
      const started = performance.now();
      let previous = started;
      for (let i = 0; i < workload.frames; i++) {
        if (workload.kind === "scroll")
          scrollTo(scrollRow(i + 1, workload.step));
        else {
          const start = performance.now();
          terminal!.write(updates[i]);
          writeMs.add(performance.now() - start);
        }
        await frame();
        const now = performance.now();
        frameIntervalMs.add(now - previous);
        previous = now;
      }
      await settle();
      if (hidden) throw new Error("Benchmark page became hidden");
      return {
        elapsedMs: performance.now() - started,
        renderMs: renderMs.report(),
        writeMs: writeMs.report(),
        frameIntervalMs: frameIntervalMs.report(),
      };
    } finally {
      Renderer.prototype.render = originalRender;
      document.removeEventListener("visibilitychange", onVisibility);
      status.textContent = "Complete";
    }
  },
  inspect() {
    const liveRows = Array.from(
      element.querySelectorAll(".term-row:not(.term-scrollback-row)"),
      (row) => row.textContent!.trimEnd(),
    );
    const historyRows = Array.from(
      element.querySelectorAll<HTMLElement>(".term-scrollback-row"),
      (row) => ({
        text: row.textContent!.trimEnd(),
        index: Math.round(
          (row.getBoundingClientRect().top -
            element.querySelector(".term-grid")!.getBoundingClientRect().top) /
            rowHeight,
        ),
      }),
    );
    return {
      resources: resources(),
      liveRows,
      historyRows,
      scrollRow: element.scrollTop / rowHeight,
    };
  },
  async allocations() {
    claim();
    await init();
    const samples = [{ stage: "initial", ...resources() }];
    let history: ReturnType<typeof api.inspect> | undefined;
    for (const [stage, output] of [
      ["alternate", "\x1b[?1049halternate"],
      ["restored", "\x1b[?1049l"],
      ["history", historyOutput("unicode")],
      ["cleared", "\x1b[3J\x1b[2J\x1b[H"],
    ]) {
      terminal!.write(output);
      await settle();
      samples.push({ stage, ...resources() });
      if (stage === "history") history = api.inspect();
    }
    status.textContent = "Complete";
    return {
      samples,
      environment: environment(),
      history,
      final: api.inspect(),
    };
  },
};

declare global {
  interface Window {
    terminalPerformance: typeof api;
  }
}

window.addEventListener(
  "pagehide",
  () => {
    terminal?.destroy();
    for (const core of cores) if (core instanceof GhosttyCore) core.dispose();
  },
  { once: true },
);

void document.fonts.ready
  .then(() => {
    if (coreName !== "builtin" && coreName !== "ghostty")
      throw new Error("Unknown core");
    window.terminalPerformance = api;
    status.textContent = "Ready";
  })
  .catch((error) => {
    status.textContent = `Failed: ${error.message}`;
  });
