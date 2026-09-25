import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { cpus, release, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { createRequire } from "node:module";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { build, createServer as createViteServer } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);
const metadata = {
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  cpu: cpus()[0]?.model,
  node: process.version,
  nodePty: require("node-pty/package.json").version,
  shell: "/bin/sh",
  term: "xterm-256color",
};

function validSize(message) {
  return (
    Number.isInteger(message.cols) &&
    Number.isInteger(message.rows) &&
    message.cols >= 2 &&
    message.cols <= 256 &&
    message.rows >= 2 &&
    message.rows <= 60
  );
}

export async function createHarnessServer({
  port = 0,
  origin,
  load = false,
} = {}) {
  if (process.platform === "win32") {
    throw new Error(
      "The PTY baseline harness requires macOS or Linux /bin/sh.",
    );
  }
  const cwd = await mkdtemp(join(tmpdir(), "wterm-pty-harness-"));
  const sessions = new Set();
  let closing;
  let allowedOrigin;
  let vite;
  let staticFiles;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const server = createServer((request, response) => {
    if (request.headers.host !== new URL(allowedOrigin).host) {
      response.writeHead(403).end();
      return;
    }
    if (request.url === "/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          activePtys: sessions.size,
          serving: load ? "production" : "development",
          ...metadata,
        }),
      );
      return;
    }
    if (staticFiles) {
      const file = staticFiles.get(request.url?.split("?")[0]);
      if (!file) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("Content-Type", file.type);
      response.end(file.body);
      return;
    }
    vite.middlewares(request, response);
  });

  server.on("upgrade", (request, socket, head) => {
    if (
      request.url !== "/pty" ||
      request.headers.origin !== allowedOrigin ||
      request.headers.host !== new URL(allowedOrigin).host
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      let terminal;
      let stop;
      const startDeadline = setTimeout(
        () => ws.close(1008, "Start required"),
        5000,
      );
      const send = (message) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      };
      ws.on("error", () => ws.terminate());
      ws.on("close", () => {
        clearTimeout(startDeadline);
        void stop?.();
      });
      ws.on("message", (bytes, binary) => {
        try {
          if (binary) throw new Error("Expected JSON");
          const message = JSON.parse(bytes.toString());
          if (message?.type === "start" && !terminal && validSize(message)) {
            clearTimeout(startDeadline);
            terminal = pty.spawn(metadata.shell, ["-i"], {
              name: metadata.term,
              cols: message.cols,
              rows: message.rows,
              cwd: mkdtempSync(join(cwd, "session-")),
              env: {
                PATH: process.env.PATH || "/usr/bin:/bin",
                TERM: metadata.term,
                LC_ALL: "C",
                PS1: "wterm$ ",
                PS2: "> ",
              },
            });
            let resolveExit;
            let stopped = false;
            let killTimer;
            const exited = new Promise((resolve) => (resolveExit = resolve));
            const entry = {
              stop: () => {
                if (!stopped) {
                  stopped = true;
                  terminal.kill();
                  killTimer = setTimeout(() => terminal.kill("SIGKILL"), 1000);
                  killTimer.unref();
                }
                return exited;
              },
            };
            stop = entry.stop;
            sessions.add(entry);
            terminal.onData((data) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const payload = JSON.stringify({ type: "output", data });
              // Bound queued output if the browser stops draining.
              if (
                ws.bufferedAmount + Buffer.byteLength(payload) >
                1024 * 1024
              ) {
                ws.close(1013, "Output queue exceeded");
                void stop();
                return;
              }
              ws.send(payload);
            });
            terminal.onExit(({ exitCode, signal }) => {
              stopped = true;
              clearTimeout(killTimer);
              sessions.delete(entry);
              send({ type: "exit", exitCode, signal });
              ws.close(1000, "Shell exited");
              resolveExit();
            });
            send({ type: "ready", pid: terminal.pid, ...metadata });
          } else if (
            message?.type === "input" &&
            terminal &&
            typeof message.data === "string"
          ) {
            terminal.write(message.data);
          } else if (
            message?.type === "resize" &&
            terminal &&
            validSize(message)
          ) {
            terminal.resize(message.cols, message.rows);
          } else {
            throw new Error("Invalid PTY message");
          }
        } catch (error) {
          send({ type: "error", message: error.message });
          ws.close(1008, "Invalid request or PTY failure");
          void stop?.();
        }
      });
    });
  });

  async function close() {
    return (closing ??= (async () => {
      for (const ws of wss.clients) ws.terminate();
      await Promise.all([...sessions].map((session) => session.stop()));
      await new Promise((resolve) => wss.close(resolve));
      await vite?.close();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      await rm(cwd, { recursive: true, force: true });
    })());
  }

  try {
    if (load) {
      // Serve an in-memory production build so Vite's development client and
      // module transforms cannot affect the timed browser workloads.
      const built = await build({
        root,
        configFile: false,
        logLevel: "warn",
        build: {
          write: false,
          rollupOptions: { input: join(root, "load.html") },
        },
      });
      const types = {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
        wasm: "application/wasm",
      };
      staticFiles = new Map();
      for (const result of Array.isArray(built) ? built : [built]) {
        for (const file of result.output) {
          staticFiles.set(`/${file.fileName}`, {
            type:
              types[file.fileName.split(".").at(-1)] ??
              "application/octet-stream",
            body: file.type === "chunk" ? file.code : Buffer.from(file.source),
          });
        }
      }
    } else {
      vite = await createViteServer({
        root,
        configFile: false,
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      });
    }
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}`;
    allowedOrigin = new URL(origin ?? url).origin;
    return {
      url,
      close,
      metadata,
      get activePtys() {
        return sessions.size;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const harness = await createHarnessServer({
    port: Number(process.env.PORT || 0),
    origin: process.env.PORTLESS_URL,
  });
  console.log(`PTY harness: ${process.env.PORTLESS_URL || harness.url}`);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await harness.close();
      process.exit(0);
    });
  }
}
