import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import * as pty from "node-pty";
import { PtyOutput } from "../lib/pty-output";
import { OUTPUT_PENDING_LIMIT, OUTPUT_WINDOW } from "../lib/terminal-protocol";

test(
  "real PTY pauses for a stalled receiver, resumes intact, and drains before exit",
  { timeout: 20000 },
  async (t) => {
    const total = 4 * 1024 * 1024;
    const expected = Buffer.alloc(total);
    for (let i = 0; i < total; i++) expected[i] = i % 256;
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    let processPty: pty.IPty | undefined;
    let flow: PtyOutput | undefined;
    let exit = false;
    let pauses = 0,
      resumes = 0,
      maxPending = 0,
      maxOutstanding = 0;
    let failure: string | undefined;
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    t.after(async () => {
      flow?.stop();
      client.terminate();
      for (const ws of server.clients) ws.terminate();
      if (processPty && !exit) processPty.kill();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    server.on("connection", (ws) => {
      const source = `
      require('node:child_process').execFileSync('stty', ['-opost'], { stdio: ['inherit', 'ignore', 'inherit'] });
      const data = Buffer.alloc(${total});
      for (let i = 0; i < data.length; i++) data[i] = i % 256;
      process.stdout.write(data, () => process.exit(0));
    `;
      processPty = pty.spawn(process.execPath, ["-e", source], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        encoding: null,
        env: { PATH: process.env.PATH!, TERM: "xterm-256color" },
      });
      flow = new PtyOutput({
        send: (data) => ws.send(data),
        bufferedAmount: () => ws.bufferedAmount,
        pause: () => {
          pauses++;
          processPty!.pause();
        },
        resume: () => {
          resumes++;
          processPty!.resume();
        },
        finish: () => ws.close(1000),
        fail: (reason) => {
          failure = reason;
          ws.close(1013);
        },
      });
      processPty.onData((data) => {
        flow!.push(data);
        maxPending = Math.max(maxPending, flow!.pendingBytes);
        maxOutstanding = Math.max(maxOutstanding, flow!.outstandingBytes);
      });
      processPty.onExit(() => {
        exit = true;
        flow!.end();
      });
      ws.on("message", (data) =>
        flow!.acknowledge(JSON.parse(data.toString()).bytes),
      );
      ws.on("error", () => {});
    });
    let received = 0;
    let acknowledge = false;
    const digest = createHash("sha256");
    client.on("message", (data, binary) => {
      assert.equal(binary, true);
      const bytes = data as Buffer;
      received += bytes.length;
      digest.update(bytes);
      if (acknowledge) client.send(JSON.stringify({ bytes: received }));
    });
    await once(client, "open");
    const deadline = Date.now() + 5000;
    while (received < OUTPUT_WINDOW && Date.now() < deadline) await delay(10);
    assert.equal(received, OUTPUT_WINDOW);
    assert.ok(pauses >= 1);
    const held = received;
    await delay(100);
    assert.equal(received, held);
    assert.equal(exit, false);
    const closed = once(client, "close");
    acknowledge = true;
    client.send(JSON.stringify({ bytes: received }));
    const [code] = await closed;
    assert.equal(failure, undefined);
    assert.equal(code, 1000);
    assert.equal(received, total);
    assert.equal(
      digest.digest("hex"),
      createHash("sha256").update(expected).digest("hex"),
    );
    assert.ok(resumes >= 1);
    assert.ok(maxOutstanding <= OUTPUT_WINDOW);
    assert.ok(maxPending <= OUTPUT_PENDING_LIMIT);
    assert.equal(exit, true);
  },
);
