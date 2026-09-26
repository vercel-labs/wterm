import { WasmBridge } from "@wterm/core";
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasm from "@wterm/ghostty/ghostty-vt.wasm?url";
import { InputRun, type InputSession } from "./input";
import {
  INPUT_COLS,
  INPUT_ROWS,
  INPUT_WORKLOADS,
  type InputWorkload,
} from "./input-workloads";
import "@wterm/dom/css";
import "./style.css";

const status = document.querySelector<HTMLElement>("#status")!;
const sessions: InputSession[] = [];
const ghosts: GhosttyCore[] = [];
let run: InputRun | undefined;
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function api() {
  return {
    start(workload: InputWorkload, probes: number) {
      if (run) throw new Error("Reload before running again");
      if (
        !INPUT_WORKLOADS.includes(workload) ||
        !Number.isInteger(probes) ||
        probes < 1 ||
        probes > 1024
      )
        throw new Error("Invalid input workload or sample count");
      status.textContent = "Running";
      run = new InputRun(sessions, workload, probes);
    },
    progress: () => run!.progress(),
    finish: () => {
      const report = run!.finish();
      status.textContent = report.complete ? "Complete" : "Failed";
      return report;
    },
    abort: (reason: string) => run?.abort(reason),
    report: () => run?.report() ?? null,
    // Harness correctness tests withhold painting without bypassing real input.
    pause: (paused: boolean) => sessions[0].terminal.setRenderingPaused(paused),
  };
}

declare global {
  interface Window {
    terminalInput: ReturnType<typeof api>;
  }
}

function dispose() {
  run?.abort("Page closed before completion");
  sessions.forEach(({ terminal }) => terminal.destroy());
  ghosts.forEach((core) => core.dispose());
}

async function init() {
  const params = new URLSearchParams(location.search);
  const coreName = params.get("core") ?? "ghostty";
  const count = Number(params.get("sessions") ?? 1);
  if (!["builtin", "ghostty"].includes(coreName) || ![1, 8].includes(count))
    throw new Error("Expected builtin/ghostty and one/eight sessions");
  await document.fonts.ready;
  for (let i = 0; i < count; i++) {
    const core =
      coreName === "builtin"
        ? await WasmBridge.load()
        : await GhosttyCore.load({ wasmPath: ghosttyWasm });
    if (core instanceof GhosttyCore) ghosts.push(core);
    // Benchmark-only adapter access, as in the output-load measurements.
    const memory =
      coreName === "builtin"
        ? (core as unknown as { memory: WebAssembly.Memory }).memory
        : (
            core as unknown as {
              wasm: { exports: { memory: WebAssembly.Memory } };
            }
          ).wasm.exports.memory;
    if (!(memory instanceof WebAssembly.Memory))
      throw new Error("Missing WASM memory");
    const element = document.createElement("div");
    element.style.width = "900px";
    if (i) {
      element.style.cssText += "position:absolute;top:0;visibility:hidden";
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    document.querySelector("#sessions")!.append(element);
    const terminal = new WTerm(element, {
      core,
      cols: INPUT_COLS,
      rows: INPUT_ROWS,
      autoResize: false,
      cursorBlink: false,
      renderingPaused: i > 0,
      onData: () => {},
    });
    sessions.push({ terminal, core, memory });
    await terminal.init();
    terminal.write("warmup\r\x1b[2K\x1b[?25l\x1b[2;24r\x1b[2;1H");
  }
  await frame();
  await frame();
  sessions[0].terminal.focus();
  window.terminalInput = api();
  status.textContent = "Ready";
}

window.addEventListener("pagehide", dispose, { once: true });
void init().catch((error) => {
  dispose();
  status.textContent = `Failed: ${error.message}`;
});
