import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import * as pty from "node-pty";
import { TerminalSessions } from "../lib/terminal-sessions";

test(
  "real PTY and socket recovery preserves bytes and the same live process",
  { timeout: 20000 },
  async (t) => {
    const total = 2 * 1024 * 1024;
    let spawns = 0;
    let pid = 0;
    let kills = 0;
    const inputs: string[] = [];
    const sessions = new TerminalSessions((size, events) => {
      spawns++;
      const source = `
      require('node:child_process').execFileSync('stty', ['raw', '-echo', '-opost'], { stdio: ['inherit', 'ignore', 'inherit'] });
      const data = Buffer.alloc(${total});
      for (let i = 0; i < data.length; i++) data[i] = i % 256;
      process.stdout.write(data);
      process.stdin.on('data', () => process.stdout.write('alive:' + process.pid));
    `;
      const proc = pty.spawn(process.execPath, ["-e", source], {
        name: "xterm-256color",
        cols: size.cols,
        rows: size.rows,
        encoding: null,
        env: { PATH: process.env.PATH!, TERM: "xterm-256color" },
      });
      pid = proc.pid;
      const data = proc.onData(events.data);
      const exit = proc.onExit(events.exit);
      return {
        write: (value) => {
          inputs.push(value);
          proc.write(value);
        },
        resize: (value) => proc.resize(value.cols, value.rows),
        pause: () => proc.pause(),
        resume: () => proc.resume(),
        dispose: (kill) => {
          data.dispose();
          exit.dispose();
          if (kill) {
            kills++;
            proc.kill();
          }
        },
      };
    });
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    server.on("connection", (socket) => sessions.accept(socket));
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `ws://127.0.0.1:${address.port}`;
    const clients: WebSocket[] = [];
    t.after(async () => {
      sessions.close();
      for (const client of clients) client.terminate();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    let token: string | null = null;
    let consumed = 0;
    let interrupted = false;
    const output: Buffer[] = [];
    const open = async (resume: boolean) => {
      const socket = new WebSocket(url);
      clients.push(socket);
      socket.on("message", (raw, binary) => {
        if (!binary) {
          const message = JSON.parse(raw.toString());
          if (message.type === "input-ack") return;
          assert.equal(message.type, "ready");
          assert.equal(message.resumed, resume);
          if (token) assert.equal(message.session, token);
          token = message.session;
          socket.send(
            JSON.stringify({
              type: "resize",
              cols: resume ? 90 : 80,
              rows: 24,
              width: 900,
              height: 480,
            }),
          );
        } else {
          const bytes = Buffer.from(raw as Buffer);
          output.push(bytes);
          consumed += bytes.length;
          if (!resume && !interrupted) {
            // Lose this ACK entirely and cut the socket with output in flight.
            interrupted = true;
            socket.terminate();
          } else if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: "ack", bytes: consumed }));
        }
      });
      await once(socket, "open");
      socket.send(
        JSON.stringify({
          type: "attach",
          session: resume ? token : null,
          bytes: consumed,
        }),
      );
      return socket;
    };
    const first = await open(false);
    await once(first, "close");
    const originalPid = pid;
    assert.ok(consumed > 0 && consumed < total);
    await delay(50);
    assert.equal(kills, 0);
    const next = await open(true);
    const deadline = Date.now() + 10000;
    while (consumed < total && Date.now() < deadline) await delay(10);
    assert.equal(consumed, total);
    const expected = Buffer.alloc(total);
    for (let i = 0; i < total; i++) expected[i] = i % 256;
    assert.deepEqual(Buffer.concat(output), expected);
    next.send(JSON.stringify({ type: "input", id: 1, data: "x" }));
    const marker = Buffer.from(`alive:${originalPid}`);
    while (consumed < total + marker.length && Date.now() < deadline)
      await delay(10);
    assert.equal(
      Buffer.concat(output).subarray(total).toString(),
      marker.toString(),
    );
    assert.equal(pid, originalPid);
    assert.equal(spawns, 1);
    assert.deepEqual(inputs, ["x"]);
    const closed = once(next, "close");
    next.send(JSON.stringify({ type: "close" }));
    await closed;
    assert.equal(kills, 1);
    assert.equal(sessions.size, 0);
  },
);
