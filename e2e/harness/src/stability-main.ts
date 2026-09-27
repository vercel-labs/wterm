import { WasmBridge } from "@wterm/core";
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasm from "@wterm/ghostty/ghostty-vt.wasm?url";
import { startStability } from "./stability";
import {
  STABILITY_COLS,
  STABILITY_ROWS,
  STABILITY_HISTORY_BYTES,
  type StabilityProfile,
} from "./stability-workload";
import "@wterm/dom/css";
import "./style.css";

const status = document.querySelector<HTMLElement>("#status")!;
const element = document.querySelector<HTMLElement>("#terminal")!;
const coreName = new URLSearchParams(location.search).get("core") ?? "ghostty";
let terminal: WTerm | undefined;
let ghostty: GhosttyCore | undefined;
let run: ReturnType<typeof startStability> | undefined;
let used = false;

async function init() {
  if (coreName !== "builtin" && coreName !== "ghostty")
    throw new Error("Unknown core");
  const core =
    coreName === "builtin"
      ? await WasmBridge.load()
      : (ghostty = await GhosttyCore.load({
          wasmPath: ghosttyWasm,
          scrollbackLimit: STABILITY_HISTORY_BYTES,
        }));
  // Benchmark-only access, matching the output-load measurement boundary.
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
    cols: STABILITY_COLS,
    rows: STABILITY_ROWS,
    autoResize: false,
    cursorBlink: false,
    onData: () => {},
  });
  await terminal.init();
  window.terminalStability = {
    run: async (profile) => {
      if (used) throw new Error("Reload before running another workload");
      used = true;
      status.textContent = "Running";
      run = startStability(terminal!, core, memory, profile);
      const report = await run.done;
      status.textContent = report.complete ? "Complete" : "Failed";
      return report;
    },
    report: () => run?.report() ?? null,
    abort: () => run?.abort(),
    running: () => run?.running() ?? false,
    pauseRendering: (paused) => terminal!.setRenderingPaused(paused),
    // Failure controls are confined to this development harness.
    dropNextWrite: () => {
      const original = core.writeRaw;
      core.writeRaw = function () {
        core.writeRaw = original;
      };
    },
  };
  status.textContent = "Ready";
}
interface StabilityApi {
  run(
    profile: StabilityProfile,
  ): Promise<import("./stability").StabilityReport>;
  report(): import("./stability").StabilityReport | null;
  abort(): void;
  running(): boolean;
  pauseRendering(paused: boolean): void;
  dropNextWrite(): void;
}
declare global {
  interface Window {
    terminalStability: StabilityApi;
  }
}
window.addEventListener(
  "pagehide",
  () => {
    run?.abort();
    terminal?.destroy();
    ghostty?.dispose();
  },
  { once: true },
);
void init().catch((error) => {
  status.textContent = `Failed: ${error.message}`;
  terminal?.destroy();
  ghostty?.dispose();
});
