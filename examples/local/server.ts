import { execFile, execFileSync } from "child_process";
import { readlink } from "fs/promises";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";

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

  function sendCwd(cwd: string) {
    if (cwd === reportedCwd || ws.readyState !== WebSocket.OPEN) return;
    reportedCwd = cwd;
    ws.send(JSON.stringify({ type: "cwd", cwd: displayCwd(cwd) }));
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
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to spawn PTY: ${msg}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "output",
            data: `\r\n\x1b[31mFailed to spawn shell: ${msg}\x1b[0m\r\n`,
          }),
        );
        ws.close();
      }
      return;
    }

    if (pixelWidth > 0 && pixelHeight > 0) {
      setPtyWindowSize(ptyProcess, rows, cols, pixelWidth, pixelHeight);
    }
    sendCwd(initialCwd);
    void reportCwd();
    cwdPoll = setInterval(() => void reportCwd(), 500);

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(() => {
      if (cwdPoll !== null) {
        clearInterval(cwdPoll);
        cwdPoll = null;
      }
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });
  }

  ws.on("message", (msg: Buffer | string) => {
    const input = typeof msg === "string" ? msg : msg.toString("utf-8");

    if (input.startsWith("\x1b[RESIZE:")) {
      const match = input.match(
        /\x1b\[RESIZE:(\d+);(\d+)(?:;(\d+);(\d+))?\]/,
      );
      if (match) {
        const cols = parseInt(match[1], 10);
        const rows = parseInt(match[2], 10);
        const pixelWidth = parseInt(match[3] || "0", 10);
        const pixelHeight = parseInt(match[4] || "0", 10);
        if (!ptyProcess) {
          spawnPTY(cols, rows, pixelWidth, pixelHeight);
        } else {
          ptyProcess.resize(cols, rows);
          if (pixelWidth > 0 && pixelHeight > 0) {
            setPtyWindowSize(ptyProcess, rows, cols, pixelWidth, pixelHeight);
          }
        }
        return;
      }
    }

    if (ptyProcess) ptyProcess.write(input);
  });

  ws.on("close", () => {
    if (cwdPoll !== null) clearInterval(cwdPoll);
    if (ptyProcess) ptyProcess.kill();
  });
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

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
