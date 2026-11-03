// Serves the page through Vite and bridges each browser tab to its own ACP
// agent process over a WebSocket.
import { spawn } from "child_process";
import { randomBytes, timingSafeEqual } from "crypto";
import { createServer, type IncomingMessage } from "http";
import { createInterface } from "readline";
import { createServer as createVite } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { AcpEvents } from "./src/acp-events";
import type { ClientEvent, UiEvent } from "./src/protocol";

const port = parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOST || "127.0.0.1";
const agentCommand = process.env.ACP_AGENT || "fx acp";
const workspace = process.env.ACP_CWD || process.cwd();

type Json = Record<string, unknown>;

function startSession(ws: WebSocket) {
  const [command, ...args] = agentCommand.split(/\s+/);
  const agent = spawn(command, args, {
    cwd: workspace,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const events = new AcpEvents();
  const pending = new Map<number, (message: Json) => void>();
  let nextId = 1;
  let sessionId = "";
  let busy = false;

  // A fast command emits many chunks; send them to the page in one frame.
  let queue: UiEvent[] = [];
  let flushTimer: NodeJS.Timeout | undefined;
  const emit = (batch: UiEvent[]) => {
    queue.push(...batch);
    flushTimer ??= setTimeout(() => {
      flushTimer = undefined;
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(queue));
      queue = [];
    }, 8);
  };

  const write = (message: Json) =>
    agent.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const request = (method: string, params: unknown) =>
    new Promise<Json>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      write({ id, method, params });
    });

  createInterface({ input: agent.stdout }).on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as Json;
    const id = message.id as number | undefined;
    if (id !== undefined && message.method === undefined) {
      pending.get(id)?.(message);
      pending.delete(id);
    } else if (message.method === "session/update") {
      emit(events.update((message.params as { update: Json }).update));
    } else if (message.method === "session/request_permission") {
      const params = message.params as {
        toolCall?: { toolCallId?: string; title?: string };
        options: { optionId: string; name: string; kind: string }[];
      };
      emit([
        {
          type: "permission",
          requestId: id!,
          toolId: params.toolCall?.toolCallId,
          title: params.toolCall?.title ?? "Permission requested",
          options: params.options,
        },
      ]);
    } else if (id !== undefined) {
      write({
        id,
        error: { code: -32601, message: `Unsupported: ${message.method}` },
      });
    }
  });

  agent.on("error", (error) =>
    emit([{ type: "error", text: `${agentCommand}: ${error.message}` }]),
  );

  (async () => {
    const init = await request("initialize", {
      protocolVersion: 1,
      // fx extension: keep terminal escapes in command output.
      _meta: { fx: { ansiOutput: true } },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "wterm-acp-agent-example", version: "0.1.0" },
    });
    const capabilities = (init.result as Json | undefined)
      ?.agentCapabilities as Json | undefined;
    const fx = (capabilities?._meta as Json | undefined)?.fx as
      Json | undefined;
    const session = await request("session/new", {
      cwd: workspace,
      mcpServers: [],
    });
    sessionId = (session.result as { sessionId: string }).sessionId;
    emit([
      { type: "session", agent: agentCommand, ansi: fx?.ansiOutput === true },
    ]);
  })().catch((error) => emit([{ type: "error", text: String(error) }]));

  return {
    async onClient(event: ClientEvent) {
      if (event.type === "permission") {
        write({
          id: event.requestId,
          result: {
            outcome: { outcome: "selected", optionId: event.optionId },
          },
        });
      } else if (event.type === "cancel") {
        write({ method: "session/cancel", params: { sessionId } });
      } else if (event.type === "prompt" && !busy && sessionId) {
        busy = true;
        events.endBlock();
        emit([{ type: "user", text: event.text }]);
        const response = await request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: event.text }],
        });
        busy = false;
        const result = response.result as { stopReason?: string } | undefined;
        emit([
          {
            type: "turn",
            stopReason: result?.stopReason ?? JSON.stringify(response.error),
          },
        ]);
      }
    },
    close: () => agent.kill(),
  };
}

// The agent can run commands in the workspace, so only this page may drive it.
// A token per run, embedded in the page, keeps other sites from connecting.
const token = randomBytes(32).toString("hex");

/** Local names only, so a DNS-rebound domain can't load the page or its token. */
function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "127.0.0.1" ||
    name === "[::1]"
  );
}

function isTrustedUpgrade(req: IncomingMessage): boolean {
  if (!isLocalHost(req.headers.host)) return false;
  let originHost = "";
  try {
    originHost = new URL(req.headers.origin ?? "").host;
  } catch {
    return false;
  }
  if (originHost !== req.headers.host) return false;
  const given = Buffer.from(
    new URL(req.url ?? "", "http://local").searchParams.get("token") ?? "",
  );
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const server = createServer();
const vite = await createVite({
  server: { middlewareMode: true, hmr: { server } },
  appType: "spa",
  plugins: [
    {
      name: "acp-session-token",
      transformIndexHtml: () => [
        { tag: "meta", attrs: { name: "acp-token", content: token } },
      ],
    },
  ],
});
server.on("request", (req, res) => {
  if (!isLocalHost(req.headers.host)) {
    res.writeHead(403).end();
    return;
  }
  vite.middlewares(req, res);
});
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // Vite's HMR socket handles its own path.
  if (new URL(req.url ?? "", "http://local").pathname !== "/ws") return;
  if (!isTrustedUpgrade(req)) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const session = startSession(ws);
    ws.on("message", (raw) => session.onClient(JSON.parse(String(raw))));
    ws.on("close", () => session.close());
  });
});

server.listen(port, hostname, () => {
  console.log(
    `> ${agentCommand} in ${workspace} on http://${hostname}:${port}`,
  );
});
