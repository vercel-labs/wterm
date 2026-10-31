import { Renderer, WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasm from "@wterm/ghostty/ghostty-vt.wasm?url";
import { EchoProbe } from "./echo-probe";
import { Samples } from "./metrics";
import {
  INPUT_COLS,
  INPUT_ROWS,
  INPUT_WORKLOADS,
  type InputWorkload,
} from "./input-workloads";
import "@wterm/dom/css";
import "./style.css";

interface FlowReport {
  exitCode: number;
  signal?: number;
  sent: number;
  acknowledged: number;
  maxPendingBytes: number;
  maxOutstandingBytes: number;
  pauses: number;
  outputMessages: number;
  ptyReads: number;
}
interface Session {
  core: GhosttyCore;
  terminal: WTerm;
  socket: WebSocket;
  pid: number | null;
  received: number;
  receivedMessages: number;
  initialReceived: number;
  ready: boolean;
  flow: FlowReport | null;
  socketError: boolean;
  closed: { code: number; reason: string; clean: boolean } | null;
  writeMs: Samples;
  renderMs: Samples;
}
const status = document.querySelector<HTMLElement>("#status")!;
const sessions: Session[] = [];
const workload =
  (new URLSearchParams(location.search).get("workload") as InputWorkload) ??
  "idle";
const count = Number(new URLSearchParams(location.search).get("sessions") ?? 1);
let probe: EchoProbe | null = null;
let expected = 0;
let startedAt = 0;
let endedAt = 0;
let error: string | null = null;
let stopping = false;
let finished = false;
let deadline: ReturnType<typeof setTimeout> | null = null;
let renderBefore: typeof Renderer.prototype.render | null = null;
let before: ReturnType<typeof resources> | null = null;

function notify(
  value: { stage: "dom" | "frame"; sequence: number } | { error: string },
) {
  void window.ptyInputObserved?.(value);
}
function fail(reason: string) {
  if (finished) return;
  const first = error === null;
  error ??= reason;
  endedAt ||= performance.now();
  stopInstrumentation();
  for (const session of sessions) session.socket.close();
  status.textContent = `Failed: ${error}`;
  if (first) notify({ error });
}
function stopInstrumentation() {
  if (deadline !== null) clearTimeout(deadline);
  deadline = null;
  probe?.stop();
  if (renderBefore) Renderer.prototype.render = renderBefore;
  renderBefore = null;
  for (const { terminal } of sessions) {
    terminal.onData = () => {};
    terminal.setRenderingPaused(true);
  }
}
function resources() {
  return sessions.map(({ core, terminal }) => ({
    wasmLinearMemoryBytes: (
      core as unknown as { wasm: { exports: { memory: WebAssembly.Memory } } }
    ).wasm.exports.memory.buffer.byteLength,
    mountedRows: terminal.element.querySelectorAll(".term-row").length,
    domElements: terminal.element.querySelectorAll("*").length,
    retainedHistoryRows: core.getScrollbackCount(),
  }));
}
function row(session: Session, index: number) {
  return Array.from({ length: INPUT_COLS }, (_, col) => {
    const cell = session.core.getCell(index, col);
    return cell.chars ?? String.fromCodePoint(cell.char || 32);
  })
    .join("")
    .trimEnd();
}
function report() {
  const elapsedMs = (endedAt || performance.now()) - startedAt;
  const style = sessions[0] && getComputedStyle(sessions[0].terminal.element);
  return {
    source: "loopback-pty" as const,
    program: "node-raw-echo" as const,
    workload,
    complete: finished && !error,
    error,
    expectedProbes: expected,
    elapsedMs,
    probes: probe?.snapshot() ?? null,
    sessions: sessions.map((session, i) => ({
      pid: session.pid,
      active: i === 0,
      receivedBytes: session.received,
      receivedMessages: session.receivedMessages,
      measuredBytes: session.received - session.initialReceived,
      receivedMiBPerSecond:
        (session.received - session.initialReceived) /
        (1024 * 1024) /
        (elapsedMs / 1000),
      writeMs: session.writeMs.report(),
      renderMs: session.renderMs.report(),
      flow: session.flow,
      socketError: session.socketError,
      closed: session.closed,
      echo: row(session, 0),
      summary: row(session, 1),
    })),
    resources: { before, after: resources() },
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      fontFamily: style?.fontFamily,
      fontSize: style?.fontSize,
      cellWidth: style?.getPropertyValue("--term-cell-width"),
      rowHeight: style?.getPropertyValue("--term-row-height"),
      visibility: document.visibilityState,
    },
  };
}
async function until(predicate: () => boolean) {
  const limit = performance.now() + 5000;
  while (!predicate()) {
    if (error) throw new Error(error);
    if (performance.now() >= limit) {
      fail("PTY did not finish within 5 seconds");
      throw new Error(error!);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function api() {
  return {
    async start(probes: number) {
      if (startedAt || !Number.isInteger(probes) || probes < 1 || probes > 1024)
        throw new Error("Invalid start");
      if (
        document.hidden ||
        document.activeElement !==
          sessions[0].terminal.element.querySelector("textarea")
      )
        throw new Error("Visible focused input required");
      expected = probes;
      before = resources();
      const original = Renderer.prototype.render;
      renderBefore = original;
      const stats = new Map(sessions.map((s) => [s.core, s.renderMs]));
      Renderer.prototype.render = function (...args) {
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          stats.get(args[0] as GhosttyCore)?.add(performance.now() - start);
        }
      };
      const active = sessions[0];
      probe = new EchoProbe(
        active.terminal.element,
        () => {
          throw new Error("Local echo forbidden");
        },
        fail,
        {
          send: (key) =>
            active.socket.send(JSON.stringify({ type: "input", data: key })),
          observed: (stage, sequence) => notify({ stage, sequence }),
        },
      );
      active.terminal.onData = (data) => probe!.input(data);
      startedAt = performance.now();
      for (const session of sessions)
        session.initialReceived = session.received;
      deadline = setTimeout(
        () => fail("PTY input run exceeded 90 seconds"),
        90_000,
      );
      for (const session of sessions)
        session.socket.send(JSON.stringify({ type: "input", data: "\x01" }));
      // The first probe must compete with output from every session.
      if (workload !== "idle")
        await until(() => sessions.every((s) => row(s, 2).includes("batch ")));
      status.textContent = "Running";
    },
    progress: () => ({ ...probe?.progress(), error }),
    report,
    pause: (paused: boolean) => sessions[0].terminal.setRenderingPaused(paused),
    abort: fail,
    async finish() {
      const state = probe?.progress();
      if (
        !state ||
        state.pending ||
        state.completed !== expected ||
        state.started !== expected
      )
        fail("Run ended without all expected echoes");
      if (error) return report();
      stopping = true;
      for (const s of sessions)
        s.socket.send(JSON.stringify({ type: "input", data: "\x02" }));
      await until(() => sessions.every((s) => !!s.flow));
      endedAt = performance.now();
      finished = true;
      stopInstrumentation();
      status.textContent = "Complete";
      return report();
    },
  };
}
declare global {
  interface Window {
    ptyInput: ReturnType<typeof api>;
    ptyInputObserved?: (
      value: { stage: "dom" | "frame"; sequence: number } | { error: string },
    ) => Promise<void>;
    ptyInputWillBlock?: () => Promise<void>;
  }
}
async function init() {
  if (![1, 8].includes(count) || !INPUT_WORKLOADS.includes(workload))
    throw new Error("Invalid PTY input fixture");
  await document.fonts.ready;
  for (let i = 0; i < count; i++) {
    if (error) throw new Error(error);
    const core = await GhosttyCore.load({ wasmPath: ghosttyWasm });
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
    await terminal.init();
    const socket = new WebSocket(
      `${location.origin.replace("http", "ws")}/pty-input`,
    );
    socket.binaryType = "arraybuffer";
    const session: Session = {
      core,
      terminal,
      socket,
      pid: null,
      received: 0,
      receivedMessages: 0,
      initialReceived: 0,
      ready: false,
      flow: null,
      socketError: false,
      closed: null,
      writeMs: new Samples(8192),
      renderMs: new Samples(8192),
    };
    sessions.push(session);
    socket.onopen = () =>
      socket.send(JSON.stringify({ type: "start", workload }));
    socket.onmessage = ({ data }) => {
      if (error || finished) return;
      try {
        if (typeof data === "string") {
          const message = JSON.parse(data);
          if (message.type === "ready") {
            session.pid = message.pid;
            session.ready = true;
          } else if (
            message.type === "finished" &&
            stopping &&
            message.exitCode === 0
          )
            session.flow = message;
          else fail(message.message ?? "Unexpected PTY exit or message");
        } else {
          const bytes = new Uint8Array(data);
          const start = performance.now();
          terminal.write(bytes);
          if (startedAt) session.writeMs.add(performance.now() - start);
          session.received += bytes.byteLength;
          session.receivedMessages++;
          socket.send(JSON.stringify({ type: "ack", bytes: session.received }));
        }
      } catch (error) {
        fail(String(error));
      }
    };
    socket.onerror = () => {
      session.socketError = true;
      fail(`PTY ${i + 1} socket failed`);
    };
    socket.onclose = (event) => {
      session.closed = {
        code: event.code,
        reason: event.reason,
        clean: event.wasClean,
      };
      if (!session.flow && !error)
        fail(
          `PTY ${i + 1} socket closed before completion (${event.code}: ${event.reason})`,
        );
    };
  }
  await until(() =>
    sessions.every((s) => s.ready && row(s, 0) === "pty ready"),
  );
  for (let i = 0; i < 2; i++)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  sessions[0].terminal.focus();
  window.ptyInput = api();
  status.textContent = "Ready";
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) fail("Page became hidden");
});
window.addEventListener(
  "pagehide",
  () => {
    fail("Page closed before completion");
    for (const { terminal, core, socket } of sessions) {
      socket.close();
      terminal.destroy();
      core.dispose();
    }
  },
  { once: true },
);
void init().catch((error) => fail(String(error)));
