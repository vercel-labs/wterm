import { GhosttyCore } from "@wterm/ghostty";
import { WasmBridge } from "@wterm/core";
import { WTerm } from "@wterm/dom";
import "@wterm/dom/css";

declare global {
  interface Window {
    ghosttyLoading: typeof GhosttyCore;
    builtinLoading: typeof WasmBridge;
    terminalSizing: typeof WTerm;
  }
}

window.ghosttyLoading = GhosttyCore;
window.builtinLoading = WasmBridge;
window.terminalSizing = WTerm;
