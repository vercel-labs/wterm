import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import {
  TerminalSessions,
  type SpawnPty,
  type TerminalSize,
} from "../lib/terminal-sessions";
import {
  HANDSHAKE_MS,
  SESSION_GRACE_MS,
  SESSION_LIMIT,
  OUTPUT_WINDOW,
  OUTPUT_PENDING_LIMIT,
} from "../lib/terminal-protocol";

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: (string | Buffer)[] = [];
  code: number | undefined;
  send(data: string | Uint8Array) {
    this.sent.push(typeof data === "string" ? data : Buffer.from(data));
  }
  close(code = 1000) {
    this.readyState = 3;
    this.code = code;
    this.emit("close", code);
  }
  message(data: object) {
    this.emit("message", Buffer.from(JSON.stringify(data)));
  }
  binary() {
    return Buffer.concat(
      this.sent.filter((data): data is Buffer => Buffer.isBuffer(data)),
    );
  }
  ready() {
    return JSON.parse(
      this.sent.find((data) => typeof data === "string") as string,
    );
  }
}
const size: TerminalSize = {
  type: "resize",
  cols: 80,
  rows: 24,
  width: 800,
  height: 480,
};
function setup() {
  let events: Parameters<SpawnPty>[1];
  let spawns = 0,
    kills = 0,
    pauses = 0;
  const inputs: string[] = [];
  const sizes: TerminalSize[] = [];
  const sessions = new TerminalSessions((initial, callbacks) => {
    spawns++;
    events = callbacks;
    sizes.push(initial);
    return {
      write: (data) => inputs.push(data),
      resize: (next) => sizes.push(next),
      pause: () => pauses++,
      resume: () => {},
      dispose: (kill) => {
        if (kill) kills++;
      },
    };
  });
  const attach = (session: string | null = null, bytes = 0) => {
    const socket = new Socket();
    sessions.accept(socket as unknown as WebSocket);
    socket.message({ type: "attach", session, bytes });
    return socket;
  };
  return {
    sessions,
    attach,
    inputs,
    sizes,
    data: (data: string | Uint8Array) => events.data(data),
    cwd: (path: string) => events.cwd(path),
    exit: () => events.exit(),
    counts: () => ({ spawns, kills, pauses }),
  };
}

test("one PTY survives detach, lost ACK, and takeover with old callbacks fenced", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const first = h.attach();
  const token = first.ready().session;
  first.message(size);
  first.message({ type: "input", id: 1, data: "once" });
  h.data("prefix");
  first.message({ type: "ack", bytes: 2 });
  h.data("suffix");
  first.close(1006);
  h.data("detached");
  assert.equal(h.counts().kills, 0);
  const second = h.attach(token, 6);
  assert.equal(second.ready().resumed, true);
  assert.equal(second.binary().toString(), "suffixdetached");
  second.message({ ...size, cols: 100 });
  const third = h.attach(token, 6);
  first.message({ type: "input", id: 2, data: "stale" });
  second.message({ type: "ack", bytes: 999999 });
  second.message({ ...size, cols: 1 });
  second.message({ type: "close" });
  second.emit("close", 1000);
  assert.equal(third.binary().toString(), "suffixdetached");
  assert.equal(h.sessions.size, 1);
  assert.equal(h.counts().spawns, 1);
  assert.deepEqual(h.inputs, ["once"]);
  assert.deepEqual(
    h.sizes.map((value) => value.cols),
    [80, 100],
  );
  third.message({ type: "ack", bytes: 20 });
  third.message({ type: "close" });
  assert.equal(h.counts().kills, 1);
  assert.equal(h.sessions.size, 0);
  t.mock.timers.tick(SESSION_GRACE_MS);
  assert.equal(h.counts().kills, 1);
});

test("expiry and unavailable output never silently create a replacement shell", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const first = h.attach();
  const token = first.ready().session;
  first.message(size);
  h.data("123456");
  first.message({ type: "ack", bytes: 4 });
  assert.equal(h.attach(token, 3).code, 4409);
  assert.equal(h.attach(token, 7).code, 4409);
  first.message({ type: "input", id: 1, data: "still alive" });
  assert.deepEqual(h.inputs, ["still alive"]);
  first.close(1006);
  t.mock.timers.tick(SESSION_GRACE_MS - 1);
  assert.equal(h.counts().kills, 0);
  t.mock.timers.tick(1);
  assert.equal(h.counts().kills, 1);
  assert.equal(h.attach(token, 4).code, 4404);
  assert.equal(h.counts().spawns, 1);
});

test("detached final output drains after reconnect and overflow releases the PTY", () => {
  const h = setup();
  const first = h.attach();
  first.message(size);
  first.close(1006);
  h.data("final");
  h.exit();
  const next = h.attach(first.ready().session, 0);
  assert.equal(next.binary().toString(), "final");
  next.message({ type: "ack", bytes: 5 });
  assert.equal(next.code, 1000);
  assert.equal(h.counts().kills, 0);
  assert.equal(h.sessions.size, 0);
  const overflow = h.attach();
  overflow.message(size);
  overflow.close(1006);
  h.data("x".repeat(OUTPUT_PENDING_LIMIT + 1));
  assert.equal(h.counts().kills, 1);
  assert.equal(h.sessions.size, 0);
});

test("unattached connections expire and session retention has a hard count limit", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const silent = new Socket();
  h.sessions.accept(silent as unknown as WebSocket);
  t.mock.timers.tick(HANDSHAKE_MS);
  assert.equal(silent.code, 1002);
  silent.message({ type: "attach", session: null, bytes: 0 });
  assert.equal(h.sessions.size, 0);
  for (let i = 0; i < SESSION_LIMIT; i++) h.attach().close(1006);
  assert.equal(h.attach().code, 1013);
  assert.equal(h.sessions.size, SESSION_LIMIT);
  t.mock.timers.tick(SESSION_GRACE_MS);
  assert.equal(h.sessions.size, 0);
});

test("working-directory updates retry after socket backlog and refresh on attachment", () => {
  const h = setup();
  const first = h.attach();
  first.message(size);
  first.bufferedAmount = OUTPUT_WINDOW + 1;
  h.cwd("/tmp");
  assert.equal(first.sent.length, 1);
  first.bufferedAmount = 0;
  h.cwd("/tmp");
  h.cwd("/tmp");
  assert.equal(first.sent.length, 2);
  first.close(1006);
  h.cwd("/tmp/new");
  const next = h.attach(first.ready().session);
  assert.deepEqual(JSON.parse(next.sent[1] as string), {
    type: "cwd",
    cwd: "/tmp/new",
  });
  h.sessions.close();
});

test("a failed shell spawn reports output once and drains before closing", () => {
  let attempts = 0;
  const sessions = new TerminalSessions(() => {
    attempts++;
    throw new Error("Shell unavailable");
  });
  const socket = new Socket();
  sessions.accept(socket as unknown as WebSocket);
  socket.message({ type: "attach", session: null, bytes: 0 });
  socket.message(size);
  socket.message(size);
  assert.equal(attempts, 1);
  assert.match(
    socket.binary().toString(),
    /Failed to spawn shell: Shell unavailable/,
  );
  assert.equal(socket.code, undefined);
  socket.message({ type: "ack", bytes: socket.binary().length });
  assert.equal(socket.code, 1000);
  assert.equal(sessions.size, 0);
});

test("accepted input IDs are deduplicated across attachments and gaps are rejected", () => {
  const h = setup();
  const first = h.attach();
  first.message(size);
  first.message({ type: "input", id: 1, data: "command\r" });
  first.message({ type: "input", id: 1, data: "command\r" });
  assert.deepEqual(JSON.parse(first.sent.at(-1) as string), {
    type: "input-ack",
    input: 1,
  });
  const next = h.attach(first.ready().session);
  assert.equal(next.ready().input, 1);
  next.message({ type: "input", id: 1, data: "command\r" });
  first.message({ type: "input", id: 2, data: "stale\r" });
  next.message({ type: "input", id: 2, data: "new\r" });
  assert.deepEqual(h.inputs, ["command\r", "new\r"]);
  assert.deepEqual(JSON.parse(next.sent.at(-1) as string), {
    type: "input-ack",
    input: 2,
  });
  next.message({ type: "input", id: 4, data: "gap\r" });
  assert.equal(next.code, 1002);
  assert.deepEqual(h.inputs, ["command\r", "new\r"]);
  assert.equal(h.sessions.size, 0);
});

test("a lost input acknowledgment retains the accepted prefix without repeating a write", () => {
  const h = setup();
  const first = h.attach();
  first.message(size);
  first.send = () => {
    throw new Error("Connection lost during ACK");
  };
  first.message({ type: "input", id: 1, data: "once\r" });
  assert.equal(first.code, 4000);
  assert.equal(h.counts().kills, 0);
  const next = h.attach(first.ready().session);
  assert.equal(next.ready().input, 1);
  next.message({ type: "input", id: 1, data: "once\r" });
  assert.deepEqual(h.inputs, ["once\r"]);
  h.sessions.close();
});

test("input acknowledgments coalesce under socket pressure and stop polling when detached", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const first = h.attach();
  first.message(size);
  first.bufferedAmount = OUTPUT_WINDOW + 1;
  for (let id = 1; id <= 100; id++)
    first.message({ type: "input", id, data: "x" });
  t.mock.timers.tick(16);
  assert.equal(first.sent.length, 1);
  first.bufferedAmount = 0;
  t.mock.timers.tick(16);
  assert.equal(first.sent.length, 2);
  assert.deepEqual(JSON.parse(first.sent[1] as string), {
    type: "input-ack",
    input: 100,
  });
  first.bufferedAmount = OUTPUT_WINDOW + 1;
  first.message({ type: "input", id: 101, data: "y" });
  first.close(1006);
  first.bufferedAmount = 0;
  t.mock.timers.tick(100);
  assert.equal(first.sent.length, 2);
  const next = h.attach(first.ready().session);
  assert.equal(next.ready().input, 101);
  next.message({ type: "input", id: 102, data: "z" });
  assert.deepEqual(JSON.parse(next.sent[1] as string), {
    type: "input-ack",
    input: 102,
  });
  assert.equal(h.inputs.length, 102);
});

test("a throwing PTY writer is never acknowledged or made available for replay", () => {
  let writes = 0,
    kills = 0;
  const sessions = new TerminalSessions(() => ({
    write: () => {
      writes++;
      throw new Error("write failed");
    },
    resize: () => {},
    pause: () => {},
    resume: () => {},
    dispose: () => {
      kills++;
    },
  }));
  const socket = new Socket();
  sessions.accept(socket as unknown as WebSocket);
  socket.message({ type: "attach", session: null, bytes: 0 });
  socket.message(size);
  socket.message({ type: "input", id: 1, data: "uncertain" });
  assert.equal(socket.code, 1011);
  assert.equal(socket.sent.length, 1);
  assert.equal(writes, 1);
  assert.equal(kills, 1);
  const next = new Socket();
  sessions.accept(next as unknown as WebSocket);
  next.message({ type: "attach", session: socket.ready().session, bytes: 0 });
  assert.equal(next.code, 4404);
});

test("invalid input IDs never reach the PTY and input after exit is not acknowledged", () => {
  for (const id of [undefined, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    const h = setup();
    const socket = h.attach();
    socket.message(size);
    socket.message({ type: "input", id, data: "rejected" });
    assert.equal(socket.code, 1002);
    assert.deepEqual(h.inputs, []);
    assert.equal(h.sessions.size, 0);
  }
  const h = setup();
  const socket = h.attach();
  socket.message(size);
  h.data("final");
  h.exit();
  const sent = socket.sent.length;
  socket.message({ type: "input", id: 1, data: "late reply" });
  socket.message({ type: "input", id: 2, data: "another late reply" });
  assert.equal(socket.sent.length, sent);
  assert.equal(socket.code, undefined);
  assert.deepEqual(h.inputs, []);
  socket.message({ type: "ack", bytes: 5 });
  assert.equal(socket.code, 1000);
});
