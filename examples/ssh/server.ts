import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { Client } from "ssh2";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port, turbopack: dev });
const handle = app.getRequestHandler();

interface ConnectParams {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

function handleSSHConnection(ws: WebSocket) {
  let sshClient: Client | null = null;

  function onFirstMessage(data: Buffer | string) {
    ws.off("message", onFirstMessage);

    const text = typeof data === "string" ? data : data.toString("utf-8");
    let params: ConnectParams;
    try {
      params = JSON.parse(text);
    } catch {
      ws.send(JSON.stringify({ error: "Invalid connection parameters" }));
      ws.close();
      return;
    }

    sshClient = new Client();

    sshClient.on("ready", () => {
      sshClient!.shell(
        { term: "xterm-256color", cols: 80, rows: 24 },
        (err, stream) => {
          if (err) {
            ws.send(
              `\r\n\x1b[31mFailed to open shell: ${err.message}\x1b[0m\r\n`,
            );
            ws.close();
            return;
          }

          stream.on("data", (chunk: Buffer) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(chunk.toString("binary"));
            }
          });

          stream.on("close", () => {
            if (ws.readyState === WebSocket.OPEN) ws.close();
          });

          ws.on("message", (msg: Buffer | string) => {
            const input = typeof msg === "string" ? msg : msg.toString("utf-8");
            try {
              stream.write(input);
            } catch {
              /* stream closed */
            }
          });

          ws.on("close", () => {
            stream.end();
            sshClient?.end();
          });
        },
      );
    });

    sshClient.on("error", (err) => {
      const msg = `\r\n\x1b[31mSSH error: ${err.message}\x1b[0m\r\n`;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
        ws.close();
      }
    });

    sshClient.on("close", () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    const connectConfig: Record<string, unknown> = {
      host: params.host,
      port: params.port || 22,
      username: params.username,
    };

    if (params.privateKey) {
      connectConfig.privateKey = params.privateKey;
    } else if (params.password) {
      connectConfig.password = params.password;
    }

    sshClient.connect(connectConfig);
  }

  ws.on("message", onFirstMessage);

  ws.on("close", () => {
    if (sshClient) sshClient.end();
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

    if (pathname === "/api/ssh") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleSSHConnection(ws);
      });
    } else {
      // Let Next.js handle HMR WebSocket upgrades
      app.getUpgradeHandler()(req, socket, head);
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> SSH Client ready on http://${hostname}:${port}`);
  });
});
