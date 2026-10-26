import { WasmBridge } from "@wterm/core";
import { Renderer, WTerm } from "@wterm/dom";
import "@wterm/dom/css";
import { halfblockFrame, logUpdate, mixedScreen, tuiFrame } from "./workloads";

type Workload = "halfblock" | "logs" | "tui";
const status = document.querySelector<HTMLElement>("#status")!;
const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => r()));
let terms: WTerm[] = [];

function layout(count: number, cols: number, rows: number) {
  const across = Math.ceil(Math.sqrt(count * (16 / 9)));
  const down = Math.ceil(count / across);
  const fontSize =
    Math.floor(
      Math.min(innerWidth / across / cols / 0.61, innerHeight / down / rows) *
        100,
    ) / 100;
  return { across, down, fontSize };
}

async function mount(count: number, cols: number, rows: number) {
  const { across, down, fontSize } = layout(count, cols, rows);
  const grid = document.createElement("div");
  grid.style.cssText = `position:fixed;inset:0;display:grid;grid-template-columns:repeat(${across},1fr);grid-template-rows:repeat(${down},1fr)`;
  document.body.append(grid);
  terms = await Promise.all(
    Array.from({ length: count }, async () => {
      const host = document.createElement("div");
      host.style.cssText = "overflow:hidden;min-width:0;min-height:0";
      grid.append(host);
      host.style.setProperty("--term-font-size", `${fontSize}px`);
      host.style.setProperty("--term-line-height", "1");
      host.style.setProperty("--term-row-height", `${Math.ceil(fontSize)}px`);
      host.style.padding = "0";
      host.style.borderRadius = "0";
      const term = new WTerm(host, {
        core: await WasmBridge.load(),
        cols,
        rows,
        autoResize: false,
        cursorBlink: false,
        onData: () => {},
      });
      await term.init();
      return term;
    }),
  );
}

function rowsText(term: WTerm) {
  return Array.from(
    term.element.querySelectorAll(".term-row:not(.term-scrollback-row)"),
    (row) => row.textContent!.replace(/\s+$/, ""),
  );
}

const api = {
  async run(opts: {
    count: number;
    cols: number;
    rows: number;
    workload: Workload;
    warm: number;
    seconds: number;
  }) {
    const { count, cols, rows, workload, warm, seconds } = opts;
    const mountStart = performance.now();
    await mount(count, cols, rows);
    const mountMs = (performance.now() - mountStart) / count;
    const frames: Uint8Array[] = [];
    if (workload === "halfblock")
      for (let n = 0; n < 90; n++) frames.push(halfblockFrame(cols, rows, n));
    if (workload === "tui")
      for (let n = 0; n < 90; n++) frames.push(tuiFrame(cols, rows, n));
    const frame = (i: number, n: number) =>
      workload === "logs" ? logUpdate(i, n, rows) : frames[(n + i * 7) % 90];
    let coreMs = 0;
    let renderMs = 0;
    let renders = 0;
    let writes = 0;
    const originalRender = Renderer.prototype.render;
    Renderer.prototype.render = function (...args) {
      const start = performance.now();
      try {
        return originalRender.apply(this, args);
      } finally {
        renderMs += performance.now() - start;
        renders++;
      }
    };
    const shown = new Array(count).fill(0);
    const begin = performance.now();
    let t0 = begin;
    let measuring = false;
    const total = (warm + seconds) * 1000;
    await Promise.all(
      terms.map(async (term, i) => {
        for (let n = 0; performance.now() - begin < total; n++) {
          if (!measuring && performance.now() - begin >= warm * 1000) {
            measuring = true;
            t0 = performance.now();
            shown.fill(0);
          }
          const start = performance.now();
          term.write(frame(i, n));
          coreMs += performance.now() - start;
          writes++;
          await nextFrame();
          shown[i]++;
        }
      }),
    );
    const elapsed = (performance.now() - t0) / 1000;
    Renderer.prototype.render = originalRender;
    const fps = shown.map((s) => s / elapsed);
    await nextFrame();
    await nextFrame();
    const last = rowsText(terms[0]);
    return {
      meanFps: fps.reduce((a, b) => a + b, 0) / fps.length,
      lastRows: last,
      coreMs: Math.round((coreMs / writes) * 100) / 100,
      renderMs: Math.round((renderMs / renders) * 100) / 100,
      mountMs: Math.round(mountMs * 100) / 100,
    };
  },
  async still(kind: "halfblock" | "logs" | "mixed" | "tui") {
    const cols = kind === "halfblock" || kind === "tui" ? 160 : 80;
    const rows = kind === "halfblock" || kind === "tui" ? 50 : 24;
    await mount(1, cols, rows);
    const term = terms[0];
    if (kind === "halfblock") term.write(halfblockFrame(cols, rows, 17));
    else if (kind === "tui") term.write(tuiFrame(cols, rows, 17));
    else if (kind === "logs")
      for (let n = 0; n < 40; n++) term.write(logUpdate(3, n, rows));
    else term.write(mixedScreen());
    await nextFrame();
    await nextFrame();
    await nextFrame();
    const rect = term.element.getBoundingClientRect();
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      rows: rowsText(term),
    };
  },
};

declare global {
  interface Window {
    throughput: typeof api;
  }
}
window.throughput = api;
void document.fonts.ready.then(() => (status.textContent = "Ready"));
