import { WasmBridge } from "@wterm/core";
import { WorkerCore } from "@wterm/core/worker";

declare global {
  interface Window {
    workerCore: typeof WorkerCore;
    directCore: typeof WasmBridge;
  }
}

window.workerCore = WorkerCore;
window.directCore = WasmBridge;
