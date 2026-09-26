import { test } from "node:test";
import assert from "node:assert/strict";
import { TerminalConnection } from "../lib/terminal-connection";
import {
  INPUT_LIMIT,
  OUTPUT_CHUNK,
  OUTPUT_FRAMES,
  OUTPUT_WINDOW,
  RECONNECT_MS,
} from "../lib/terminal-protocol";

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  ready(session = "a".repeat(64), resumed = false) {
    this.onmessage?.({
      data: JSON.stringify({ type: "ready", session, resumed }),
    });
  }
  output(data: Uint8Array) {
    this.onmessage?.({ data: new Uint8Array(data).buffer });
  }
}

function setup(write?: (data: Uint8Array) => void) {
  const socket = new Socket();
  const received: Buffer[] = [];
  const ends: string[] = [];
  const errors: (string | null)[] = [];
  const connection = new TerminalConnection(
    () => socket as unknown as WebSocket,
    {
      write: write ?? ((data) => received.push(Buffer.from(data))),
      open: () => {},
      cwd: () => {},
      end: (message) => ends.push(message),
      inputError: (message) => errors.push(message),
      reconnecting: () => {},
    },
  );
  socket.onopen?.();
  socket.ready();
  socket.sent.length = 0;
  return {
    socket,
    connection,
    received,
    ends,
    errors,
    messages: () =>
      socket.sent
        .map((text) => JSON.parse(text))
        .filter((message) => message.type !== "close"),
  };
}

test("ACK follows parsing and preserves fragmented bytes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { socket, connection, received, messages } = setup();
  const source = Buffer.from("語😀\x1b[?2026hheld\x1b[?2026l");
  socket.output(source.subarray(0, 2));
  socket.output(source.subarray(2));
  assert.equal(received.length, 0);
  assert.deepEqual(messages(), []);
  t.mock.timers.runAll();
  assert.deepEqual(Buffer.concat(received), source);
  assert.deepEqual(messages(), [{ type: "ack", bytes: source.length }]);
  // A parser callback need not wait for a renderer to release synchronized output.
  connection.close();
});

test("a parser task yields before consuming more than 32 KiB", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { socket, connection, received } = setup();
  for (let i = 0; i < 4; i++) socket.output(new Uint8Array(12000));
  let firstTaskBytes = 0;
  setTimeout(() => {
    firstTaskBytes = Buffer.concat(received).length;
  }, 0);
  t.mock.timers.runAll();
  assert.ok(firstTaskBytes > 0 && firstTaskBytes <= 32 * 1024);
  assert.equal(Buffer.concat(received).length, 48000);
  connection.close();
});

test("slow control sends retain only the latest ACK and resize", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { socket, connection, messages } = setup();
  socket.bufferedAmount = INPUT_LIMIT + 1;
  connection.resize(80, 24, 800, 400);
  connection.resize(100, 30, 1000, 600);
  socket.output(Buffer.from("one"));
  t.mock.timers.tick(0);
  socket.output(Buffer.from("two"));
  t.mock.timers.tick(0);
  assert.deepEqual(messages(), []);
  socket.bufferedAmount = 0;
  t.mock.timers.tick(16);
  assert.deepEqual(messages(), [
    { type: "resize", cols: 100, rows: 30, width: 1000, height: 600 },
    { type: "ack", bytes: 6 },
  ]);
  connection.close();
});

test("remote close drains received output before reporting the session ended", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { socket, received, ends } = setup();
  socket.output(Buffer.from("last bytes"));
  socket.close();
  assert.deepEqual(ends, []);
  t.mock.timers.runAll();
  assert.equal(Buffer.concat(received).toString(), "last bytes");
  assert.deepEqual(ends, ["Session ended."]);
});

test("explicit close cancels parser tasks and ignores late callbacks", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { socket, connection, received, ends } = setup();
  const message = socket.onmessage;
  socket.output(Buffer.from("cancelled"));
  connection.close();
  message?.({ data: new Uint8Array([1]).buffer });
  t.mock.timers.runAll();
  assert.deepEqual(received, []);
  assert.deepEqual(ends, []);
  assert.deepEqual(socket.sent, [JSON.stringify({ type: "close" })]);
});

test("oversized and over-window output closes rather than growing a queue", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const oversized = setup();
  oversized.socket.output(new Uint8Array(OUTPUT_CHUNK + 1));
  assert.match(oversized.ends[0], /buffer limit/);
  const flooded = setup();
  for (let i = 0; i <= OUTPUT_WINDOW / OUTPUT_CHUNK; i++)
    flooded.socket.output(new Uint8Array(OUTPUT_CHUNK));
  assert.match(flooded.ends[0], /buffer limit/);
  const smallFrames = setup();
  for (let i = 0; i <= OUTPUT_FRAMES; i++)
    smallFrames.socket.output(new Uint8Array([1]));
  assert.match(smallFrames.ends[0], /buffer limit/);
  t.mock.timers.runAll();
  assert.equal(flooded.received.length, 0);
});

test("a failed parser does not grant credit", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { socket, messages, ends } = setup(() => {
    throw new Error("write failed");
  });
  socket.output(Buffer.from("bad"));
  t.mock.timers.runAll();
  assert.deepEqual(messages(), []);
  assert.match(ends[0], /could not be processed/);
});

test("input JSON cannot masquerade as ACKs and rejected pastes are atomic", () => {
  const { socket, connection, messages, errors } = setup();
  connection.input('{"type":"ack","bytes":999}');
  assert.deepEqual(messages(), [
    { type: "input", data: '{"type":"ack","bytes":999}' },
  ]);
  connection.input("😀".repeat(INPUT_LIMIT / 2));
  connection.input("\x00".repeat(INPUT_LIMIT / 2));
  assert.equal(socket.sent.length, 1);
  assert.match(errors.at(-1)!, /too large/);
  socket.bufferedAmount = INPUT_LIMIT;
  connection.input("x");
  assert.equal(socket.sent.length, 1);
  assert.match(errors.at(-1)!, /busy/);
  connection.close();
});

test("reconnect uses parsed bytes, drops unparsed frames, and never repeats input", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sockets: Socket[] = [];
  const received: Buffer[] = [];
  const notices: string[] = [];
  const opens: boolean[] = [];
  let reconnects = 0;
  const connection = new TerminalConnection(
    () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    {
      write: (data) => received.push(Buffer.from(data)),
      open: (resumed) => opens.push(resumed),
      cwd: () => {},
      end: (message) => notices.push(message),
      inputError: (message) => {
        if (message) notices.push(message);
      },
      reconnecting: () => reconnects++,
    },
  );
  const first = sockets[0];
  first.onopen?.();
  first.ready();
  // The core has consumed a UTF-8 prefix; the rest is only queued.
  first.output(new Uint8Array([0xf0, 0x9f]));
  t.mock.timers.tick(0);
  first.output(new Uint8Array([0x99, 0x82]));
  connection.input("command\r");
  const lateMessage = first.onmessage;
  const lateClose = first.onclose;
  first.close(1006);
  connection.input("offline");
  connection.resize(90, 30, 900, 600);
  t.mock.timers.tick(250);
  const next = sockets[1];
  next.onopen?.();
  assert.deepEqual(JSON.parse(next.sent[0]), {
    type: "attach",
    session: "a".repeat(64),
    bytes: 2,
  });
  assert.equal(connection.connected, false);
  next.ready("a".repeat(64), true);
  lateMessage?.({ data: new Uint8Array([0xff]).buffer });
  lateClose?.({ code: 1000 });
  next.output(new Uint8Array([0x99, 0x82]));
  t.mock.timers.tick(0);
  assert.equal(Buffer.concat(received).toString(), "🙂");
  assert.equal(reconnects, 1);
  const messages = next.sent.map((message) => JSON.parse(message));
  assert.equal(
    messages.filter((message) => message.type === "input").length,
    0,
  );
  assert.deepEqual(
    messages.find((message) => message.type === "resize"),
    { type: "resize", cols: 90, rows: 30, width: 900, height: 600 },
  );
  assert.deepEqual(messages.at(-1), { type: "ack", bytes: 4 });
  assert.deepEqual(opens, [false, true]);
  assert.equal(connection.connected, true);
  connection.close();
  t.mock.timers.tick(RECONNECT_MS);
  assert.equal(sockets.length, 2);
});

test("unanswered handshakes and socket creation failures stop retrying at the deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const ends: string[] = [];
  let created = 0;
  const connection = new TerminalConnection(
    () => {
      created++;
      if (created > 1) throw new Error("offline");
      return new Socket() as unknown as WebSocket;
    },
    {
      write: () => {},
      open: () => {},
      cwd: () => {},
      inputError: () => {},
      reconnecting: () => {},
      end: (message) => ends.push(message),
    },
  );
  for (let i = 0; i < 40; i++) t.mock.timers.tick(1000);
  assert.equal(ends.length, 1);
  assert.match(ends[0], /reconnect in time/);
  const stoppedAt = created;
  t.mock.timers.tick(RECONNECT_MS);
  assert.equal(created, stoppedAt);
  connection.close();
});
