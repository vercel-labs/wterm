import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import * as pty from "node-pty";
import { TerminalConnection } from "../lib/terminal-connection";
import { TerminalSessions } from "../lib/terminal-sessions";

test(
  "real PTY input survives lost acknowledgments without replaying accepted or missing commands",
  { timeout: 15000 },
  async (t) => {
    let spawns = 0,
      kills = 0,
      pid = 0,
      lostAcks = 0;
    const writes: string[] = [];
    const sessions = new TerminalSessions((size, events) => {
      spawns++;
      const proc = pty.spawn(
        process.execPath,
        [
          "-e",
          `
      require('node:child_process').execFileSync('stty', ['raw', '-echo', '-opost'], { stdio: ['inherit', 'ignore', 'inherit'] });
      let count = 0;
      process.stdin.on('data', data => {
        for (const byte of data) process.stdout.write(++count + ':' + byte + ':' + process.pid + '\\n');
      });
      process.stdout.write('ready\\n');
    `,
        ],
        {
          name: "xterm-256color",
          cols: size.cols,
          rows: size.rows,
          encoding: null,
          env: { PATH: process.env.PATH!, TERM: "xterm-256color" },
        },
      );
      pid = proc.pid;
      const data = proc.onData(events.data);
      const exit = proc.onExit(events.exit);
      return {
        write: (value) => {
          writes.push(value);
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
    server.on("connection", (socket) => {
      const send = socket.send;
      socket.send = (data, ...args) => {
        // Drop the first acceptance receipt while still delivering shell output.
        if (
          typeof data === "string" &&
          JSON.parse(data).type === "input-ack" &&
          lostAcks === 0
        ) {
          lostAcks++;
          return;
        }
        Reflect.apply(send, socket, [data, ...args]);
      };
      sessions.accept(socket);
    });
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const clients: WebSocket[] = [];
    const opens: [boolean, boolean][] = [];
    const errors: string[] = [];
    let output = "";
    let connection: TerminalConnection;
    t.after(async () => {
      connection?.close();
      sessions.close();
      for (const client of clients) client.terminate();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    connection = new TerminalConnection(
      () => {
        const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
        const first = clients.length === 0;
        const send = socket.send;
        socket.send = (data, ...args) => {
          // The client hands off ID 2, but the interrupted link never delivers it.
          if (first && typeof data === "string") {
            const message = JSON.parse(data);
            if (message.type === "input" && message.id === 2) return;
          }
          Reflect.apply(send, socket, [data, ...args]);
        };
        clients.push(socket);
        return socket as unknown as globalThis.WebSocket;
      },
      {
        write: (data) => {
          output += Buffer.from(data).toString();
        },
        open: (resumed, lost) => {
          opens.push([resumed, lost]);
          connection.resize(80, 24, 800, 480);
        },
        cwd: () => {},
        reconnecting: () => {},
        inputError: (message) => {
          if (message) errors.push(message);
        },
        end: (message) => errors.push(message),
      },
    );
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) await delay(10);
      assert.ok(
        predicate(),
        `Timed out; output=${JSON.stringify(output)}, errors=${errors}`,
      );
    };
    await waitFor(() => output === "ready\n");
    connection.input("x");
    await waitFor(() => output.includes(`1:120:${pid}\n`));
    assert.equal(lostAcks, 1);
    connection.input("y");
    clients[0].terminate();
    await waitFor(() => opens.length === 2);
    assert.deepEqual(opens, [
      [false, false],
      [true, true],
    ]);
    assert.deepEqual(writes, ["x"]);
    // Even explicitly duplicating the accepted ID cannot run it twice.
    clients[1].send(JSON.stringify({ type: "input", id: 1, data: "x" }));
    connection.input("z");
    await waitFor(() => output.includes(`2:122:${pid}\n`));
    assert.equal(output, `ready\n1:120:${pid}\n2:122:${pid}\n`);
    assert.deepEqual(writes, ["x", "z"]);
    assert.equal(spawns, 1);
    assert.equal(kills, 0);
    assert.deepEqual(errors, []);
    connection.close();
    await waitFor(() => sessions.size === 0);
    assert.equal(kills, 1);
  },
);
