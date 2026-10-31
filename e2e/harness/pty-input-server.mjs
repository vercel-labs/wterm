import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { WebSocket } from "ws";
import { PtyOutputQueue } from "../../examples/local/lib/pty-output-queue.mts";

export const INPUT_WINDOW = 64 * 1024;
const PENDING_LIMIT = 1024 * 1024;
const fixture = fileURLToPath(
  new URL("pty-input-fixture.mjs", import.meta.url),
);

/** Dedicated, bounded loopback endpoint; never accepts a command or program path. */
export function attachPtyInput(ws, cwd, sessions) {
  let terminal;
  let entry;
  let exit;
  let stopped = false;
  let paused = false;
  const queue = new PtyOutputQueue(PENDING_LIMIT, 1024, 16384, flush);
  let sent = 0;
  let acknowledged = 0;
  let maxPendingBytes = 0;
  let maxOutstandingBytes = 0;
  let pauses = 0;
  let outputMessages = 0;
  let ptyReads = 0;
  let producing = false;
  let finishing = false;
  let inputs = 0;
  let killTimer;
  let resolveExit;
  const exited = new Promise((resolve) => (resolveExit = resolve));
  const deadline = setTimeout(
    () => fail("PTY input run exceeded 90 seconds"),
    90_000,
  );
  const startDeadline = setTimeout(() => fail("Start required"), 5000);
  const send = (value) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
  };
  function stop() {
    if (!stopped) {
      stopped = true;
      clearTimeout(deadline);
      clearTimeout(startDeadline);
      queue.clear();
      if (terminal && !exit) {
        // node-pty delivers exit after draining the read side. A credit-paused
        // reader must resume during teardown even though output is discarded.
        if (paused) {
          paused = false;
          terminal.resume();
        }
        terminal.kill();
        killTimer = setTimeout(() => terminal.kill("SIGKILL"), 1000);
        killTimer.unref();
      }
    }
    return terminal ? exited : Promise.resolve();
  }
  function fail(message) {
    send({ type: "error", message });
    ws.close(1008, "PTY input measurement failed");
    void stop();
  }
  function flush() {
    if (stopped || ws.readyState !== WebSocket.OPEN || queue.batching) return;
    while (queue.pendingBytes && sent - acknowledged < INPUT_WINDOW) {
      const data = queue.peek(INPUT_WINDOW - (sent - acknowledged));
      const length = data.length;
      if (ws.bufferedAmount + length > INPUT_WINDOW) {
        fail("Socket output queue exceeded");
        return;
      }
      ws.send(data, { binary: true });
      outputMessages++;
      sent += length;
      queue.consume(length);
      maxOutstandingBytes = Math.max(maxOutstandingBytes, sent - acknowledged);
    }
    if (!exit) {
      if (
        !paused &&
        (queue.pendingBytes || sent - acknowledged >= INPUT_WINDOW)
      ) {
        paused = true;
        pauses++;
        terminal.pause();
      } else if (
        paused &&
        !queue.pendingBytes &&
        sent - acknowledged <= INPUT_WINDOW / 4
      ) {
        paused = false;
        terminal.resume();
      }
    }
    if (exit && !queue.pendingBytes && acknowledged === sent) {
      send({
        type: "finished",
        ...exit,
        sent,
        acknowledged,
        maxPendingBytes,
        maxOutstandingBytes,
        pauses,
        outputMessages,
        ptyReads,
      });
      ws.close(1000, "Measurement finished");
      void stop();
    }
  }
  ws.on("error", () => ws.terminate());
  ws.on("close", () => void stop());
  ws.on("message", (data, binary) => {
    if (stopped || ws.readyState !== WebSocket.OPEN) return;
    try {
      if (binary) throw new Error("Expected JSON control message");
      const message = JSON.parse(data.toString());
      if (
        !terminal &&
        message.type === "start" &&
        ["idle", "ansi", "redraw"].includes(message.workload)
      ) {
        clearTimeout(startDeadline);
        terminal = pty.spawn(process.execPath, [fixture, message.workload], {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd,
          env: {
            PATH: process.env.PATH || "/usr/bin:/bin",
            TERM: "xterm-256color",
            LC_ALL: "C",
          },
        });
        entry = { stop };
        sessions.add(entry);
        terminal.onData((text) => {
          if (stopped) return;
          ptyReads++;
          if (!queue.push(text)) {
            fail("Pending PTY output exceeded its limit");
            return;
          }
          maxPendingBytes = Math.max(maxPendingBytes, queue.pendingBytes);
          queue.schedule();
        });
        terminal.onExit((result) => {
          exit = result;
          queue.cancel();
          clearTimeout(killTimer);
          sessions.delete(entry);
          resolveExit();
          flush();
        });
        send({
          type: "ready",
          pid: terminal.pid,
          program: "node-raw-echo",
          intervalMs: 16,
          outputWindow: INPUT_WINDOW,
        });
      } else if (
        terminal &&
        message.type === "ack" &&
        Number.isSafeInteger(message.bytes) &&
        message.bytes >= acknowledged &&
        message.bytes <= sent
      ) {
        acknowledged = message.bytes;
        flush();
      } else if (
        terminal &&
        !exit &&
        message.type === "input" &&
        typeof message.data === "string" &&
        /^[a-z\x01\x02]$/.test(message.data)
      ) {
        if (message.data === "\x01" && !producing) producing = true;
        else if (message.data === "\x02" && producing && !finishing)
          finishing = true;
        else if (
          /^[a-z]$/.test(message.data) &&
          producing &&
          !finishing &&
          inputs < 1024
        )
          inputs++;
        else throw new Error("Invalid input order or sample limit exceeded");
        terminal.write(message.data);
      } else throw new Error("Invalid PTY input message");
    } catch (error) {
      fail(error.message);
    }
  });
}
