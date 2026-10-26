import { WTerm } from "@wterm/dom";
import "@wterm/dom/css";
import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasm from "@wterm/ghostty/ghostty-vt.wasm?url";
import { cycle, halfblock, kitty, logs, type Workload } from "./workloads";

export type RendererType =
  "wterm" | "wterm-webgl" | "wterm-ghostty" | "wterm-ghostty-webgl";

interface Instance {
  write(data: string): Promise<void>;
}

const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => r()));

async function mount(
  type: RendererType,
  host: HTMLElement,
  cols: number,
  rows: number,
  fontSize: number,
  count: number,
): Promise<Instance> {
  const core = type.startsWith("wterm-ghostty")
    ? await GhosttyCore.load({ wasmPath: ghosttyWasm })
    : undefined;
  host.style.setProperty("--term-font-size", `${fontSize}px`);
  host.style.setProperty("--term-line-height", "1");
  host.style.setProperty("--term-row-height", `${Math.ceil(fontSize)}px`);
  host.style.setProperty("--term-font-family", "monospace");
  host.style.padding = "0";
  const term = new WTerm(host, {
    cols,
    rows,
    autoResize: false,
    core,
    renderer: type.endsWith("webgl") ? "webgl" : "dom",
    onData: () => {},
  });
  await term.init();
  (window as unknown as { terms?: WTerm[] }).terms ??= [];
  (window as unknown as { terms: WTerm[] }).terms.push(term);
  return {
    write: (data) => {
      term.write(data);
      return nextFrame();
    },
  };
}

export interface RunResult {
  type: RendererType;
  count: number;
  meanFps: number;
  minFps: number;
  mountMs: number;
  longTasks: number;
  /** Terminals painting through the GPU canvas when the run ended. */
  gpuVisible: number;
}

export async function run(
  type: RendererType,
  count: number,
  cols: number,
  rows: number,
  workload: "halfblock" | "logs" | "kitty",
  seconds = 8,
  warm = 2,
): Promise<RunResult> {
  document.body.innerHTML = "";
  const across = Math.ceil(Math.sqrt(count * (16 / 9)));
  const down = Math.ceil(count / across);
  const grid = document.createElement("div");
  grid.style.cssText = `position:fixed;inset:0;display:grid;grid-template-columns:repeat(${across},1fr);grid-template-rows:repeat(${down},1fr);overflow:hidden`;
  document.body.append(grid);
  const fontSize =
    Math.floor(
      Math.min(innerWidth / across / cols / 0.6, innerHeight / down / rows) *
        100,
    ) / 100;

  const gens: Workload[] = Array.from({ length: count }, (_, i) =>
    workload === "halfblock"
      ? cycle(`halfblock-${cols}x${rows}`, () => halfblock(cols, rows))
      : workload === "kitty"
        ? cycle(`kitty-${cols}x${rows}`, () => kitty(cols, rows), 30)
        : cycle(`logs-${i}`, () => logs(i)),
  );
  const t0 = performance.now();
  const instances: Instance[] = [];
  for (let i = 0; i < count; i++) {
    const host = document.createElement("div");
    host.style.overflow = "hidden";
    grid.append(host);
    instances.push(await mount(type, host, cols, rows, fontSize, count));
  }
  const mountMs = (performance.now() - t0) / count;

  let longTasks = 0;
  const obs = new PerformanceObserver(
    (l) => (longTasks += l.getEntries().length),
  );
  obs.observe({ type: "longtask", buffered: false });

  const counts = new Array(count).fill(0);
  let counting = false;
  let stop = false;
  await Promise.all(
    instances
      .map(async (inst, i) => {
        let n = 0;
        while (!stop) {
          await inst.write(gens[i](n++));
          if (counting) counts[i]++;
        }
      })
      .concat([
        (async () => {
          await new Promise((r) => setTimeout(r, warm * 1000));
          counting = true;
          await new Promise((r) => setTimeout(r, seconds * 1000));
          counting = false;
          stop = true;
        })(),
      ]),
  );
  obs.disconnect();
  const fps = counts.map((c) => c / seconds);
  return {
    type,
    count,
    meanFps: fps.reduce((a, b) => a + b, 0) / count,
    minFps: Math.min(...fps),
    mountMs,
    longTasks,
    gpuVisible: document.querySelectorAll(".term-gpu-canvas:not([hidden])")
      .length,
  };
}

(window as unknown as { bench: typeof run }).bench = run;
import "./visual";
