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

function handlePTYConnection(ws: WebSocket) {
  const shell = process.env.SHELL || "/bin/zsh";
  let ptyProcess: pty.IPty | null = null;

  function spawnPTY(cols: number, rows: number) {
    try {
      ptyProcess = pty.spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.env.HOME || "/",
        env: cleanEnv(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to spawn PTY: ${msg}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[31mFailed to spawn shell: ${msg}\x1b[0m\r\n`);
        ws.close();
      }
      return;
    }

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ptyProcess.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });
  }

  ws.on("message", (msg: Buffer | string) => {
    const input = typeof msg === "string" ? msg : msg.toString("utf-8");

    if (input.startsWith("\x1b[RESIZE:")) {
      const match = input.match(/\x1b\[RESIZE:(\d+);(\d+)\]/);
      if (match) {
        const cols = parseInt(match[1], 10);
        const rows = parseInt(match[2], 10);
        if (!ptyProcess) {
          spawnPTY(cols, rows);
        } else {
          ptyProcess.resize(cols, rows);
        }
        return;
      }
    }

    if (ptyProcess) ptyProcess.write(input);
  });

  ws.on("close", () => {
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
