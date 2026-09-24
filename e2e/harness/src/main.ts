import { WasmBridge, type TerminalCore } from "@wterm/core";
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasm from "@wterm/ghostty/ghostty-vt.wasm?url";
import { Samples } from "./metrics";
import "@wterm/dom/css";
import "./style.css";

const params = new URLSearchParams(location.search);
const coreName = params.get("core") ?? "builtin";
const replay = params.get("mode") === "replay";
if (coreName !== "builtin" && coreName !== "ghostty") {
  throw new Error(`Unknown core: ${coreName}`);
}
const element = document.querySelector<HTMLDivElement>("#terminal")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;
const metricsElement = document.querySelector<HTMLPreElement>("#metrics")!;
const probeButton = document.querySelector<HTMLButtonElement>("#probe")!;
const selector = document.querySelector<HTMLSelectElement>("#core")!;
selector.value = coreName;
selector.addEventListener("change", () => {
  params.set("core", selector.value);
  location.search = params.toString();
});
document
  .querySelector("#restart")!
  .addEventListener("click", () => location.reload());

const writeMs = new Samples();
const receiveToFrameMs = new Samples();
const roundTripMs = new Samples();
const encoder = new TextEncoder();
const startedAt = new Date().toISOString();
let outputBytes = 0;
let state = "loading";
let serverMetadata: Record<string, unknown> | null = null;
let core: TerminalCore;
let terminal: WTerm;
let socket: WebSocket;
let outputTail = "";
const responses: string[] = [];
let pendingProbe: {
  marker: string;
  matched: boolean;
  start: number;
  resolve: (ms: number) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
let disposed = false;
let pendingFrame: number | null = null;

function setState(next: string, label: string): void {
  state = next;
  status.textContent = label;
  probeButton.disabled = next !== "connected" || pendingProbe !== null;
}

function report() {
  return {
    schemaVersion: 1,
    core: coreName,
    source: replay ? "replay" : "pty",
    startedAt,
    state,
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      server: serverMetadata,
    },
    terminal: { cols: core?.getCols(), rows: core?.getRows() },
    outputBytes,
    timings: {
      writeMs: writeMs.report(),
      receiveToFrameMs: receiveToFrameMs.report(),
      roundTripToFrameMs: roundTripMs.report(),
    },
  };
}

function snapshot() {
  const cells = Array.from({ length: core.getRows() }, (_, row) =>
    Array.from({ length: core.getCols() }, (_, col) => core.getCell(row, col)),
  );
  const rows = Array.from({ length: core.getRows() }, (_, row) => {
    let text = "";
    for (let col = 0; col < core.getCols(); col++) {
      const cell = cells[row][col];
      if (cell.width !== 0)
        text += cell.chars ?? String.fromCodePoint(cell.char || 32);
    }
    return text.trimEnd();
  });
  return {
    rows,
    cursor: core.getCursor(),
    cols: core.getCols(),
    height: core.getRows(),
    cells,
    modes: {
      alternateScreen: core.usingAltScreen(),
      bracketedPaste: core.bracketedPaste(),
      cursorKeysApp: core.cursorKeysApp(),
      synchronizedOutput: core.synchronizedOutput?.() ?? false,
    },
    scrollbackCount: core.getScrollbackCount(),
    history: Array.from(
      { length: Math.min(core.getScrollbackCount(), 100) },
      (_, index) => {
        const offset = Math.min(core.getScrollbackCount(), 100) - 1 - index;
        let text = "";
        for (let col = 0; col < core.getScrollbackLineLen(offset); col++) {
          const cell = core.getScrollbackCell(offset, col);
          if (cell.width !== 0)
            text += cell.chars ?? String.fromCodePoint(cell.char || 32);
        }
        return text.trimEnd();
      },
    ),
    responses: [...responses],
  };
}

function sendInput(data: string): void {
  if (replay) {
    if (responses.length >= 1024)
      throw new Error("Replay response limit exceeded");
    responses.push(data);
    return;
  }
  if (socket?.readyState !== WebSocket.OPEN || state !== "connected") return;
  socket.send(JSON.stringify({ type: "input", data }));
}

function failProbe(message: string): void {
  if (!pendingProbe) return;
  const probe = pendingProbe;
  pendingProbe = null;
  clearTimeout(probe.timer);
  probe.reject(new Error(message));
  probeButton.disabled = state !== "connected";
}

function runProbe(): Promise<number> {
  if (state !== "connected" || pendingProbe)
    return Promise.reject(new Error("Shell is not ready for a probe"));
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const marker = `WTERM_PROBE_${suffix}`;
  return new Promise((resolve, reject) => {
    pendingProbe = {
      marker,
      matched: false,
      start: performance.now(),
      resolve,
      reject,
      timer: setTimeout(() => failProbe("Round trip timed out"), 5000),
    };
    probeButton.disabled = true;
    // The complete marker is absent from the command, so terminal echo cannot
    // satisfy the probe. The shell must execute printf to assemble it.
    sendInput(`printf '\\nWTERM_PROBE_%s\\n' '${suffix}'\r`);
  });
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  failProbe("Session closed");
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
  socket?.close();
  terminal?.destroy();
  if (core instanceof GhosttyCore) core.dispose();
}

function writeOutput(data: string | Uint8Array): void {
  const received = performance.now();
  outputBytes +=
    typeof data === "string"
      ? encoder.encode(data).byteLength
      : data.byteLength;
  const writeStart = performance.now();
  terminal.write(data);
  writeMs.add(performance.now() - writeStart);
  if (typeof data === "string") outputTail = (outputTail + data).slice(-1024);
  if (pendingProbe && outputTail.includes(pendingProbe.marker))
    pendingProbe.matched = true;
  if (pendingFrame !== null) return;
  // WTerm schedules its render first. This measures a frame opportunity,
  // not physical display latency.
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    const now = performance.now();
    receiveToFrameMs.add(now - received);
    if (pendingProbe?.matched) {
      const probe = pendingProbe;
      pendingProbe = null;
      clearTimeout(probe.timer);
      const duration = now - probe.start;
      roundTripMs.add(duration);
      probe.resolve(duration);
      probeButton.disabled = state !== "connected";
    }
    metricsElement.textContent = JSON.stringify(report().timings, null, 2);
  });
}

function replayWrite(base64: string, chunkBytes: number): void {
  if (!replay || disposed) throw new Error("Replay session is not active");
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1)
    throw new Error("Invalid chunk size");
  const data = Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0));
  for (let offset = 0; offset < data.length; offset += chunkBytes) {
    writeOutput(data.subarray(offset, offset + chunkBytes));
  }
}

export type HarnessAPI = {
  report: typeof report;
  snapshot: typeof snapshot;
  runProbe: typeof runProbe;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  replayWrite: typeof replayWrite;
  frame: () => Promise<void>;
};
declare global {
  interface Window {
    ptyHarness: HarnessAPI;
  }
}

async function init() {
  core =
    coreName === "ghostty"
      ? await GhosttyCore.load({ wasmPath: ghosttyWasm })
      : await WasmBridge.load();
  terminal = new WTerm(element, {
    core,
    cols: 80,
    rows: 24,
    autoResize: false,
    cursorBlink: params.has("cursorBlink")
      ? params.get("cursorBlink") === "true"
      : undefined,
    onData: sendInput,
    onResize: (cols, rows) => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
    },
  });
  await terminal.init();
  window.ptyHarness = {
    report,
    snapshot,
    runProbe,
    resize: (cols, rows) => terminal.resize(cols, rows),
    close: () => {
      dispose();
      setState("closed", "Session closed");
    },
    replayWrite,
    frame: () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve())),
  };
  document.querySelector("#download")!.addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report(), null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `wterm-${replay ? "replay" : "pty"}-${coreName}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  window.addEventListener("pagehide", dispose, { once: true });
  if (replay) {
    document.querySelector("header p")!.textContent =
      "Recorded terminal output; no shell is running.";
    setState("replay", "Replay ready");
    return;
  }
  setState("connecting", "Connecting…");
  const url = new URL("/pty", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(url);
  socket.addEventListener("open", () =>
    socket.send(JSON.stringify({ type: "start", cols: 80, rows: 24 })),
  );
  socket.addEventListener("message", (event) => {
    if (disposed) return;
    const message = JSON.parse(event.data);
    if (message.type === "ready") {
      serverMetadata = message;
      setState("connected", "Connected · /bin/sh");
    } else if (message.type === "output") {
      writeOutput(message.data);
    } else if (message.type === "exit") {
      failProbe("Shell exited");
      setState("exited", `Shell exited (${message.exitCode})`);
    } else if (message.type === "error") {
      failProbe(message.message);
      setState("error", message.message);
    }
  });
  socket.addEventListener("error", () =>
    setState("error", "Connection failed"),
  );
  socket.addEventListener("close", () => {
    failProbe("Connection closed");
    if (state === "connected" || state === "connecting")
      setState("closed", "Connection closed");
  });
  probeButton.addEventListener(
    "click",
    () =>
      void runProbe().catch((error) => {
        status.textContent = error.message;
      }),
  );
}

void init().catch((error) => {
  dispose();
  setState("error", `Initialization failed: ${error.message}`);
});
