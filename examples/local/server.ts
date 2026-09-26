import { execFile, execFileSync } from "child_process";
import { readlink } from "fs/promises";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { PtyOutput } from "./lib/pty-output";
import {
  CONTROL_RESERVE,
  INPUT_LIMIT,
  OUTPUT_WINDOW,
  isResize,
} from "./lib/terminal-protocol";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port, turbopack: dev });
const handle = app.getRequestHandler();

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

function displayCwd(cwd: string): string {
  const normalized = cwd.replace(/[/\\]+$/, "") || "/";
  const home = (process.env.HOME || "").replace(/[/\\]+$/, "");
  if (home && (normalized === home || normalized.startsWith(`${home}/`))) {
    return `~${normalized.slice(home.length)}` || "~";
  }
  return normalized;
}

function setPtyWindowSize(
  ptyProcess: pty.IPty,
  rows: number,
  cols: number,
  width: number,
  height: number,
): void {
  if (process.platform === "win32") return;

  const fd = (ptyProcess as pty.IPty & { fd?: number }).fd;
  if (fd === undefined) return;

  // node-pty's resize API intentionally resets ws_xpixel/ws_ypixel to zero.
  // Kitty's icat reads those fields with TIOCGWINSZ before it starts, so use
  // the platform's standard ioctl through the system Perl that is available
  // on macOS and common Unix development environments.
  const request = process.platform === "darwin" ? 0x80087467 : 0x5414;
  const safeWidth = Math.min(0xffff, Math.max(1, Math.round(width)));
  const safeHeight = Math.min(0xffff, Math.max(1, Math.round(height)));
  const script = `my $ws=pack("S4",${rows},${cols},${safeWidth},${safeHeight}); ioctl(STDIN,${request},$ws) or exit 1`;
  try {
    execFileSync("perl", ["-e", script], {
      stdio: [fd, "ignore", "ignore"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to set PTY pixel size: ${message}`);
  }
}

function handlePTYConnection(ws: WebSocket) {
  const shell = process.env.SHELL || "/bin/zsh";
  let ptyProcess: pty.IPty | null = null;
  let cwdPoll: ReturnType<typeof setInterval> | null = null;
  let cwdQueryInFlight = false;
  let reportedCwd: string | null = null;
  let stopped = false;
  let exited = false;
  let started = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    output.stop();
    if (cwdPoll !== null) clearInterval(cwdPoll);
    cwdPoll = null;
    if (ptyProcess && !exited) ptyProcess.kill();
  };
  const output = new PtyOutput({
    send: (data) => {
      if (ws.readyState !== WebSocket.OPEN) throw new Error("Socket closed");
      ws.send(data);
    },
    bufferedAmount: () => ws.bufferedAmount,
    pause: () => ptyProcess?.pause(),
    resume: () => ptyProcess?.resume(),
    finish: () => {
      stop();
      ws.close(1000, "Session ended");
    },
    fail: () => {
      stop();
      ws.close(1013, "Output could not be kept in sync");
    },
  });

  function sendCwd(cwd: string) {
    if (stopped || cwd === reportedCwd || ws.readyState !== WebSocket.OPEN)
      return;
    const message = JSON.stringify({ type: "cwd", cwd: displayCwd(cwd) });
    if (
      Buffer.byteLength(message) > CONTROL_RESERVE ||
      ws.bufferedAmount > OUTPUT_WINDOW
    )
      return;
    reportedCwd = cwd;
    ws.send(message);
  }

  function getProcessCwd(pid: number): Promise<string | null> {
    if (process.platform === "linux") {
      return readlink(`/proc/${pid}/cwd`).catch(() => null);
    }

    if (process.platform !== "darwin") return Promise.resolve(null);

    return new Promise((resolve) => {
      execFile(
        "lsof",
        ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
        { encoding: "utf8" },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          const match = stdout.match(/^n(.+)$/m);
          resolve(match?.[1] ?? null);
        },
      );
    });
  }

  async function reportCwd() {
    if (!ptyProcess || cwdQueryInFlight) return;
    cwdQueryInFlight = true;
    try {
      const cwd = await getProcessCwd(ptyProcess.pid);
      if (cwd) sendCwd(cwd);
    } finally {
      cwdQueryInFlight = false;
    }
  }

  function spawnPTY(
    cols: number,
    rows: number,
    pixelWidth: number,
    pixelHeight: number,
  ) {
    const initialCwd = process.env.HOME || "/";
    try {
      ptyProcess = pty.spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: initialCwd,
        env: cleanEnv(),
        encoding: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to spawn PTY: ${msg}`);
      if (ws.readyState === WebSocket.OPEN) {
        output.push(`\r\n\x1b[31mFailed to spawn shell: ${msg}\x1b[0m\r\n`);
        output.end();
      }
      return;
    }

    if (pixelWidth > 0 && pixelHeight > 0) {
      setPtyWindowSize(ptyProcess, rows, cols, pixelWidth, pixelHeight);
    }
    sendCwd(initialCwd);
    void reportCwd();
    cwdPoll = setInterval(() => void reportCwd(), 500);

    ptyProcess.onData((data) => output.push(data));

    ptyProcess.onExit(() => {
      exited = true;
      if (cwdPoll !== null) clearInterval(cwdPoll);
      cwdPoll = null;
      output.end();
    });
  }

  ws.on("message", (raw) => {
    if (stopped) return;
    try {
      const message = JSON.parse(raw.toString());
      if (!message || typeof message !== "object") throw new Error();
      if (isResize(message)) {
        const { cols, rows, width, height } = message;
        if (!started) {
          started = true;
          spawnPTY(cols, rows, width, height);
        } else if (ptyProcess && !exited) {
          ptyProcess.resize(cols, rows);
          setPtyWindowSize(ptyProcess, rows, cols, width, height);
        }
      } else if (message.type === "ack") {
        output.acknowledge(message.bytes);
      } else if (
        message.type === "input" &&
        typeof message.data === "string" &&
        Buffer.byteLength(message.data) <= INPUT_LIMIT &&
        started
      ) {
        // Final output can generate terminal replies after the process exits.
        // Keep draining that output even though there is no process to read input.
        if (ptyProcess && !exited) ptyProcess.write(message.data);
      } else throw new Error();
    } catch {
      stop();
      ws.close(1002, "Invalid terminal message");
    }
  });

  ws.on("error", stop);
  ws.on("close", stop);
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: INPUT_LIMIT + CONTROL_RESERVE,
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "/", true);

    if (pathname === "/api/terminal") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handlePTYConnection(ws);
      });
    } else {
      app.getUpgradeHandler()(req, socket, head);
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> Local Terminal ready on http://${hostname}:${port}`);
  });
});
