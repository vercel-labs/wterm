import { test } from "node:test";
import assert from "node:assert/strict";
import { TerminalConnection } from "../lib/terminal-connection";
import {
  INPUT_LIMIT,
  INPUT_MESSAGES,
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
  ready(session = "a".repeat(64), resumed = false, input = 0) {
    this.onmessage?.({
      data: JSON.stringify({ type: "ready", session, resumed, input }),
    });
  }
  acknowledge(input: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type: "input-ack", input }) });
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
    { type: "input", id: 1, data: '{"type":"ack","bytes":999}' },
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

test("unacknowledged input has byte and message limits even when the socket buffer is empty", () => {
  const small = setup();
  for (let i = 0; i < INPUT_MESSAGES; i++) small.connection.input("");
  small.connection.input("blocked");
  assert.equal(small.messages().length, INPUT_MESSAGES);
  assert.match(small.errors.at(-1)!, /busy/);
  small.socket.acknowledge(INPUT_MESSAGES - 1);
  small.socket.acknowledge(INPUT_MESSAGES - 1);
  small.connection.input("available");
  assert.deepEqual(small.messages().at(-1), {
    type: "input",
    id: INPUT_MESSAGES + 1,
    data: "available",
  });
  small.connection.close();

  const large = setup();
  large.connection.input("x".repeat(INPUT_LIMIT / 2));
  large.connection.input("y".repeat(INPUT_LIMIT / 2));
  assert.equal(large.messages().length, 1);
  assert.match(large.errors.at(-1)!, /busy/);
  large.socket.acknowledge(1);
  large.connection.input("z".repeat(INPUT_LIMIT / 2));
  assert.equal(large.messages().length, 2);
  assert.equal(large.messages()[1].id, 2);
  large.connection.close();
});

for (const accepted of [0, 1, 2]) {
  test(`reconnect confirms ${accepted} inputs, abandons only the missing suffix, and never replays text`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const sockets: Socket[] = [];
    const opens: [boolean, boolean][] = [];
    const ends: string[] = [];
    const connection = new TerminalConnection(
      () => {
        const socket = new Socket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      {
        write: () => {},
        cwd: () => {},
        inputError: () => {},
        reconnecting: () => {},
        open: (resumed, lost) => opens.push([resumed, lost]),
        end: (message) => ends.push(message),
      },
    );
    const first = sockets[0];
    first.onopen?.();
    first.ready();
    connection.input("first");
    connection.input("second");
    const staleAck = first.onmessage;
    first.close(1006);
    t.mock.timers.tick(250);
    const next = sockets[1];
    next.onopen?.();
    next.ready("a".repeat(64), true, accepted);
    assert.deepEqual(opens, [
      [false, false],
      [true, accepted < 2],
    ]);
    assert.equal(next.sent.length, 1, "reattachment never resends input");
    staleAck?.({ data: JSON.stringify({ type: "input-ack", input: 999 }) });
    connection.input("new input");
    assert.deepEqual(JSON.parse(next.sent.at(-1)!), {
      type: "input",
      id: accepted + 1,
      data: "new input",
    });
    next.acknowledge(accepted + 1);
    next.close();
    t.mock.timers.tick(0);
    assert.deepEqual(ends, ["Session ended."]);
  });
}

test("send failures remain uncertain until reconnect confirms acceptance", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sockets: Socket[] = [];
  const opens: [boolean, boolean][] = [];
  const connection = new TerminalConnection(
    () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    {
      write: () => {},
      cwd: () => {},
      inputError: () => {},
      reconnecting: () => {},
      end: () => {},
      open: (resumed, lost) => opens.push([resumed, lost]),
    },
  );
  const first = sockets[0];
  first.onopen?.();
  first.ready();
  first.send = () => {
    throw new Error("unknown send outcome");
  };
  connection.input("command\r");
  t.mock.timers.tick(250);
  const next = sockets[1];
  next.onopen?.();
  next.ready("a".repeat(64), true, 1);
  assert.deepEqual(opens, [
    [false, false],
    [true, false],
  ]);
  assert.equal(next.sent.length, 1);
  connection.close();
});

test("invalid or regressing input acknowledgments end the connection without hiding uncertainty", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const value of [
    undefined,
    -1,
    0.5,
    "1",
    2,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const h = setup();
    h.connection.input("unconfirmed");
    h.socket.acknowledge(value);
    assert.match(h.ends[0], /incompatible/);
    assert.match(h.ends[0], /could not be confirmed/);
    assert.equal(h.connection.connected, false);
  }
  const regression = setup();
  regression.connection.input("accepted");
  regression.socket.acknowledge(1);
  regression.socket.acknowledge(0);
  assert.match(regression.ends[0], /incompatible/);
  assert.doesNotMatch(regression.ends[0], /could not be confirmed/);
});

test("an unresolved disconnect retains the input uncertainty notice after retry expiry", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const socket = new Socket();
  const ends: string[] = [];
  let attempt = 0;
  const connection = new TerminalConnection(
    () => {
      if (attempt++) throw new Error("offline");
      return socket as unknown as WebSocket;
    },
    {
      write: () => {},
      cwd: () => {},
      inputError: () => {},
      reconnecting: () => {},
      open: () => {},
      end: (message) => ends.push(message),
    },
  );
  socket.onopen?.();
  socket.ready();
  connection.input("command\r");
  socket.close(1006);
  for (let i = 0; i < 30; i++) t.mock.timers.tick(1000);
  assert.equal(ends.length, 1);
  assert.match(ends[0], /could not reconnect in time/);
  assert.match(ends[0], /could not be confirmed and was not resent/);
  assert.equal(
    socket.sent.filter((raw) => JSON.parse(raw).type === "input").length,
    1,
  );
});
