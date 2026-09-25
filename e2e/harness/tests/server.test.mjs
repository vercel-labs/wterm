import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { stat } from "node:fs/promises";
import { WebSocket } from "ws";
import { createHarnessServer } from "../server.mjs";

const unixOnly = {
  timeout: 15000,
  skip: process.platform === "win32" ? "Requires macOS/Linux PTYs" : false,
};

async function connect(server) {
  const ws = new WebSocket(`${server.url.replace("http", "ws")}/pty`, {
    headers: { origin: server.url },
  });
  const messages = [];
  ws.on("message", (bytes) => messages.push(JSON.parse(bytes.toString())));
  await once(ws, "open");
  return { ws, messages };
}

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("Timed out waiting for PTY state");
}

test(
  "disconnect and server shutdown terminate their real shell processes",
  unixOnly,
  async (t) => {
    const server = await createHarnessServer();
    t.after(() => server.close());
    const first = await connect(server);
    const second = await connect(server);
    for (const { ws } of [first, second])
      ws.send(JSON.stringify({ type: "start", cols: 80, rows: 24 }));
    await until(() =>
      [first, second].every(({ messages }) =>
        messages.some((m) => m.type === "ready"),
      ),
    );
    const pids = [first, second].map(
      ({ messages }) => messages.find((m) => m.type === "ready").pid,
    );
    assert.notEqual(pids[0], pids[1]);
    assert.equal(server.activePtys, 2);
    for (const { ws } of [first, second]) {
      ws.send(
        JSON.stringify({ type: "input", data: 'printf "CWD_%s\\n" "$PWD"\r' }),
      );
    }
    const sessionCwd = ({ messages }) =>
      messages
        .filter((message) => message.type === "output")
        .map((message) => message.data)
        .join("")
        .match(/CWD_(\/[^\r\n]+)/)?.[1];
    await until(() => sessionCwd(first) && sessionCwd(second));
    const directories = [sessionCwd(first), sessionCwd(second)];
    assert.notEqual(directories[0], directories[1]);
    first.ws.close();
    await until(() => server.activePtys === 1);
    assert.throws(() => process.kill(pids[0], 0), { code: "ESRCH" });
    await server.close();
    assert.equal(server.activePtys, 0);
    assert.throws(() => process.kill(pids[1], 0), { code: "ESRCH" });
    for (const directory of directories) {
      await assert.rejects(stat(directory), { code: "ENOENT" });
    }
  },
);

test(
  "rejects invalid dimensions before spawning a PTY",
  unixOnly,
  async (t) => {
    const server = await createHarnessServer();
    t.after(() => server.close());
    const { ws, messages } = await connect(server);
    const closed = once(ws, "close");
    ws.send(JSON.stringify({ type: "start", cols: 999999, rows: 24 }));
    const [code] = await closed;
    assert.equal(code, 1008);
    assert.equal(server.activePtys, 0);
    assert.equal(messages[0].type, "error");
  },
);

test("rejects cross-origin WebSocket upgrades", unixOnly, async (t) => {
  const server = await createHarnessServer();
  t.after(() => server.close());
  const ws = new WebSocket(`${server.url.replace("http", "ws")}/pty`, {
    headers: { origin: "https://example.com" },
  });
  const [error] = await once(ws, "error");
  assert.match(error.message, /403/);
  assert.equal(server.activePtys, 0);
});

test(
  "serves load measurements from a production bundle only",
  unixOnly,
  async (t) => {
    const server = await createHarnessServer({ load: true });
    t.after(() => server.close());
    const html = await (await fetch(`${server.url}/load.html`)).text();
    assert.doesNotMatch(html, /@vite\/client|\/src\/load-main/);
    const script = html.match(/src="([^"]+\.js)"/)[1];
    const response = await fetch(`${server.url}${script}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/javascript");
    const code = await response.text();
    assert.doesNotMatch(code, /vite-hmr/);
    assert.equal((await fetch(`${server.url}/src/load-main.ts`)).status, 404);
    assert.equal((await fetch(`${server.url}/@vite/client`)).status, 404);
    assert.equal((await fetch(`${server.url}/assets/missing.js`)).status, 404);
    const health = await (await fetch(`${server.url}/health`)).json();
    assert.equal(health.serving, "production");
    assert.equal(health.activePtys, 0);
  },
);
