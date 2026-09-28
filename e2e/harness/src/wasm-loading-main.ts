import { GhosttyCore } from "@wterm/ghostty";
import { WasmBridge } from "@wterm/core";

declare global {
  interface Window {
    ghosttyLoading: typeof GhosttyCore;
    builtinLoading: typeof WasmBridge;
  }
}

window.ghosttyLoading = GhosttyCore;
window.builtinLoading = WasmBridge;
