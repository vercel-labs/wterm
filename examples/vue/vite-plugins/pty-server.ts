import type { Plugin } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import * as pty from "node-pty";
import { parse as parseUrl } from "url";

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

function handlePTYConnection(ws: WebSocket) {
  const shell = process.env.SHELL || "/bin/zsh";

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || "/",
      env: cleanEnv(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to spawn PTY: ${msg}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\n\x1b[31mFailed to spawn shell: ${msg}\x1b[0m\r\n`);
      ws.close();
    }
    return;
  }

  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  ptyProcess.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close();
  });

  ws.on("message", (msg: Buffer | string) => {
    const input = typeof msg === "string" ? msg : msg.toString("utf-8");

    if (input.startsWith("\x1b[RESIZE:")) {
      const match = input.match(/\x1b\[RESIZE:(\d+);(\d+)\]/);
      if (match) {
        ptyProcess.resize(parseInt(match[1], 10), parseInt(match[2], 10));
        return;
      }
    }

    ptyProcess.write(input);
  });

  ws.on("close", () => {
    ptyProcess.kill();
  });
}

export function ptyServer(): Plugin {
  return {
    name: "pty-server",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        const { pathname } = parseUrl(req.url || "/", true);
        if (pathname !== "/api/terminal") return;

        wss.handleUpgrade(req, socket, head, (ws) => {
          handlePTYConnection(ws);
        });
      });
    },
  };
}
