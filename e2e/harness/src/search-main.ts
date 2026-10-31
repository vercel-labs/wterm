import { WTerm, type SearchState } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasm from "@wterm/ghostty/ghostty-vt.wasm?url";
import { Samples } from "./metrics";
import {
  SEARCH_COLS,
  SEARCH_ROWS,
  SEARCH_HISTORY_BYTES,
  SEARCH_QUERIES,
  searchLine,
} from "./search-workload";
import "@wterm/dom/css";
import "./style.css";

const status = document.querySelector<HTMLElement>("#status")!;
const element = document.querySelector<HTMLElement>("#terminal")!;
const lines = Number(
  new URLSearchParams(location.search).get("lines") ?? 10000,
);
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
let terminal: WTerm | undefined;
let core: GhosttyCore | undefined;
let abort: ((reason: string) => void) | undefined;
let used = false;
let measurement: SearchReport | null = null;

type SearchReport = {
  complete: boolean;
  error: string | null;
  query: string;
  lines: number;
  retainedRows: number;
  discardedRows: number;
  firstResultsMs: number | null;
  completeMs: number | null;
  firstHighlightFrameMs: number | null;
  state: SearchState;
  frames: ReturnType<Samples["report"]>;
  taskDelay: ReturnType<Samples["report"]>;
  mountedRows: number;
  environment: {
    userAgent: string;
    devicePixelRatio: number;
    font: string;
    rowHeight: string;
    cellWidth: string;
  };
};

function run(query: string): Promise<SearchReport> {
  if (used) throw new Error("Reload before measuring another search");
  if (!SEARCH_QUERIES.includes(query as (typeof SEARCH_QUERIES)[number]))
    throw new Error("Unknown search query");
  used = true;
  status.textContent = "Searching";
  const frames = new Samples(16384),
    taskDelay = new Samples(16384);
  const started = performance.now();
  const styles = getComputedStyle(element);
  const report: SearchReport = (measurement = {
    complete: false,
    error: null,
    query,
    lines,
    retainedRows: core!.getScrollbackCount() + core!.getRows(),
    discardedRows: core!.getScrollbackDiscardedCount(),
    firstResultsMs: null,
    completeMs: null,
    firstHighlightFrameMs: null,
    state: terminal!.getSearchState(),
    frames: frames.report(),
    taskDelay: taskDelay.report(),
    mountedRows: element.querySelectorAll(".term-row").length,
    environment: {
      userAgent: navigator.userAgent,
      devicePixelRatio,
      font: `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize}/${styles.lineHeight} ${styles.fontFamily}`,
      rowHeight: styles.getPropertyValue("--term-row-height"),
      cellWidth: styles.getPropertyValue("--term-cell-width"),
    },
  });
  return new Promise((resolve) => {
    let ended = false;
    let lastFrame = started,
      expectedTask = started + 16;
    let animation = 0,
      timer = 0;
    const finish = (error: string | null) => {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(animation);
      clearTimeout(timer);
      clearTimeout(deadline);
      document.removeEventListener("visibilitychange", visibility);
      terminal!.onSearchChange = null;
      if (error) terminal!.clearSearch();
      report.complete = error === null;
      report.error = error;
      report.frames = frames.report();
      report.taskDelay = taskDelay.report();
      report.mountedRows = element.querySelectorAll(".term-row").length;
      abort = undefined;
      status.textContent = error ? "Failed" : "Complete";
      resolve(report);
    };
    const visibility = () => {
      if (document.hidden) finish("Page became hidden");
    };
    const tickFrame = () => {
      const now = performance.now();
      frames.add(now - lastFrame);
      lastFrame = now;
      if (
        report.firstHighlightFrameMs === null &&
        element.querySelector(".term-search-active")
      )
        report.firstHighlightFrameMs = now - started;
      if (
        report.completeMs !== null &&
        (!report.state.count || report.firstHighlightFrameMs !== null)
      )
        finish(null);
      else animation = requestAnimationFrame(tickFrame);
    };
    const tickTask = () => {
      taskDelay.add(Math.max(0, performance.now() - expectedTask));
      expectedTask = performance.now() + 16;
      timer = window.setTimeout(tickTask, 16);
    };
    const deadline = window.setTimeout(
      () => finish("Search exceeded 60 seconds"),
      60000,
    );
    abort = finish;
    document.addEventListener("visibilitychange", visibility);
    if (document.hidden) {
      finish("Page is hidden");
      return;
    }
    animation = requestAnimationFrame(tickFrame);
    timer = window.setTimeout(tickTask, 16);
    terminal!.onSearchChange = (state) => {
      report.state = state;
      if (state.count && report.firstResultsMs === null)
        report.firstResultsMs = performance.now() - started;
      if (!state.searching) report.completeMs = performance.now() - started;
    };
    try {
      terminal!.search(query);
    } catch (error) {
      finish(error instanceof Error ? error.message : String(error));
    }
  });
}

function api() {
  return {
    run,
    report: () => measurement,
    state: () => terminal!.getSearchState(),
    abort: (reason: string) => abort?.(reason),
  };
}
declare global {
  interface Window {
    terminalSearch: ReturnType<typeof api>;
  }
}

async function init() {
  if (![10000, 100000].includes(lines))
    throw new Error("Expected 10000 or 100000 lines");
  core = await GhosttyCore.load({
    wasmPath: ghosttyWasm,
    scrollbackLimit: SEARCH_HISTORY_BYTES,
  });
  await document.fonts.ready;
  terminal = new WTerm(element, {
    core,
    cols: SEARCH_COLS,
    rows: SEARCH_ROWS,
    autoResize: false,
    cursorBlink: false,
    renderingPaused: true,
  });
  await terminal.init();
  for (let offset = 0; offset < lines; offset += 256) {
    let chunk = "";
    for (let row = offset; row < Math.min(lines, offset + 256); row++)
      chunk += searchLine(row, lines) + "\r\n";
    terminal.write(chunk);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  terminal.setRenderingPaused(false);
  await frame();
  await frame();
  if (
    core.getScrollbackDiscardedCount() !== 0 ||
    core.getScrollbackCount() + core.getRows() !== lines + 1
  )
    throw new Error("Corpus is not fully retained");
  window.terminalSearch = api();
  status.textContent = "Ready";
}
window.addEventListener(
  "pagehide",
  () => {
    abort?.("Page closed");
    terminal?.destroy();
    core?.dispose();
  },
  { once: true },
);
void init().catch((error) => {
  status.textContent = `Failed: ${error.message}`;
  terminal?.destroy();
  core?.dispose();
});
