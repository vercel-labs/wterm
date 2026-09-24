import { WasmBridge } from "@wterm/core";
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasm from "@wterm/ghostty/ghostty-vt.wasm?url";
import { runLoad, type LoadReport } from "./load";
import { LOAD_COLS, LOAD_ROWS, type LoadWorkload } from "./load-workloads";
import "@wterm/dom/css";
import "./style.css";

const status = document.querySelector<HTMLElement>("#status")!;
const element = document.querySelector<HTMLElement>("#terminal")!;
const coreName = new URLSearchParams(location.search).get("core") ?? "ghostty";
let terminal: WTerm | undefined;
let ghostty: GhosttyCore | undefined;
let used = false;
let report: LoadReport | null = null;

declare global {
  interface Window {
    terminalLoad: {
      run: (workload: LoadWorkload, bytes: number) => Promise<LoadReport>;
      report: () => LoadReport | null;
    };
  }
}

async function init() {
  if (coreName !== "builtin" && coreName !== "ghostty")
    throw new Error("Unknown core");
  const core =
    coreName === "builtin"
      ? await WasmBridge.load()
      : (ghostty = await GhosttyCore.load({ wasmPath: ghosttyWasm }));
  // Benchmark-only access to each shipped adapter's linear memory. Fail if
  // its layout changes rather than silently reporting missing/zero memory.
  const memory: WebAssembly.Memory =
    coreName === "builtin"
      ? (core as unknown as { memory: WebAssembly.Memory }).memory
      : (
          core as unknown as {
            wasm: { exports: { memory: WebAssembly.Memory } };
          }
        ).wasm.exports.memory;
  if (!(memory instanceof WebAssembly.Memory))
    throw new Error("Missing WASM memory");
  await document.fonts.ready;
  terminal = new WTerm(element, {
    core,
    cols: LOAD_COLS,
    rows: LOAD_ROWS,
    autoResize: false,
    cursorBlink: false,
    onData: () => {},
  });
  await terminal.init();
  window.terminalLoad = {
    run: async (workload, bytes) => {
      if (used) throw new Error("Reload before running another workload");
      used = true;
      status.textContent = "Running";
      return runLoad(terminal!, core, memory, workload, bytes, (value) => {
        report = value;
        status.textContent = value.complete ? "Complete" : "Failed";
      });
    },
    report: () => report,
  };
  status.textContent = "Ready";
}

window.addEventListener(
  "pagehide",
  () => {
    terminal?.destroy();
    ghostty?.dispose();
  },
  { once: true },
);
void init().catch((error) => {
  status.textContent = `Failed: ${error.message}`;
});
