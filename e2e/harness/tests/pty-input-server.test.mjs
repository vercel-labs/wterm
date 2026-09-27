import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createHarnessServer } from "../server.mjs";
import { INPUT_WINDOW } from "../pty-input-server.mjs";

const unixOnly = {
  timeout: 15000,
  skip: process.platform === "win32" ? "Requires macOS/Linux PTYs" : false,
};
async function until(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("Timed out waiting for PTY state");
}
async function connect(server, workload = "ansi") {
  const ws = new WebSocket(`${server.url.replace("http", "ws")}/pty-input`, {
    headers: { origin: server.url },
  });
  const state = { messages: [], received: 0, autoAck: false };
  const send = (value) => ws.send(JSON.stringify(value));
  ws.on("message", (bytes, binary) => {
    if (!binary) state.messages.push(JSON.parse(bytes.toString()));
    else {
      state.received += bytes.length;
      if (state.autoAck) send({ type: "ack", bytes: state.received });
    }
  });
  await once(ws, "open");
  send({ type: "start", workload });
  return { ws, state, send };
}

test(
  "PTY output waits for browser credit and drains before successful completion",
  unixOnly,
  async (t) => {
    const server = await createHarnessServer();
    t.after(() => server.close());
    const { ws, state, send } = await connect(server);
    await until(
      () =>
        state.messages.some((m) => m.type === "ready") && state.received > 0,
    );
    const pid = state.messages.find((m) => m.type === "ready").pid;
    send({ type: "input", data: "\x01" });
    await until(() => state.received === INPUT_WINDOW);
    await delay(100);
    assert.equal(state.received, INPUT_WINDOW);
    assert.equal(ws.readyState, WebSocket.OPEN);
    state.autoAck = true;
    send({ type: "ack", bytes: state.received });
    await until(() => state.received > INPUT_WINDOW);
    const closed = once(ws, "close");
    send({ type: "input", data: "\x02" });
    const [code] = await closed;
    assert.equal(code, 1000);
    const result = state.messages.find((m) => m.type === "finished");
    assert.equal(result.exitCode, 0);
    assert.equal(result.sent, state.received);
    assert.equal(result.acknowledged, state.received);
    assert.equal(result.maxOutstandingBytes, INPUT_WINDOW);
    assert.ok(result.pauses > 0);
    assert.ok(result.maxPendingBytes <= 1024 * 1024);
    assert.equal(server.activePtys, 0);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  },
);

for (const message of [
  { type: "ack", bytes: 9999999 },
  { type: "input", data: "echo command\r" },
  { type: "input", data: "a" },
]) {
  test(
    `rejects invalid PTY control ${JSON.stringify(message)} and kills the child`,
    unixOnly,
    async (t) => {
      const server = await createHarnessServer();
      t.after(() => server.close());
      const { ws, state, send } = await connect(server, "idle");
      await until(() => state.messages.some((m) => m.type === "ready"));
      const pid = state.messages.find((m) => m.type === "ready").pid;
      const closed = once(ws, "close");
      send(message);
      assert.equal((await closed)[0], 1008);
      await until(() => server.activePtys === 0);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      assert.ok(state.messages.some((m) => m.type === "error"));
    },
  );
}

test(
  "closing the browser or server terminates benchmark PTYs",
  unixOnly,
  async (t) => {
    const server = await createHarnessServer();
    t.after(() => server.close());
    const clients = [await connect(server), await connect(server)];
    await until(() =>
      clients.every((c) => c.state.messages.some((m) => m.type === "ready")),
    );
    const pids = clients.map(
      (c) => c.state.messages.find((m) => m.type === "ready").pid,
    );
    for (const client of clients) client.send({ type: "input", data: "\x01" });
    await until(() => clients.every((c) => c.state.received === INPUT_WINDOW));
    clients[0].ws.close();
    await until(() => server.activePtys === 1);
    await server.close();
    assert.equal(server.activePtys, 0);
    for (const pid of pids)
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  },
);

test("PTY input endpoint rejects cross-origin access", unixOnly, async (t) => {
  const server = await createHarnessServer();
  t.after(() => server.close());
  const ws = new WebSocket(`${server.url.replace("http", "ws")}/pty-input`, {
    headers: { origin: "https://example.com" },
  });
  assert.match((await once(ws, "error"))[0].message, /403/);
  assert.equal(server.activePtys, 0);
});
