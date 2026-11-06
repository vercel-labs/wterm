import { GhosttyCore } from "@wterm/ghostty";
import { WasmBridge } from "@wterm/core";
import { WorkerCore } from "@wterm/core/worker";
import { WTerm } from "@wterm/dom";
import "@wterm/dom/css";

declare global {
  interface Window {
    ghosttyLoading: typeof GhosttyCore;
    builtinLoading: typeof WasmBridge;
    workerLoading: typeof WorkerCore;
    terminalSizing: typeof WTerm;
  }
}

window.ghosttyLoading = GhosttyCore;
window.builtinLoading = WasmBridge;
window.workerLoading = WorkerCore;
window.terminalSizing = WTerm;
