import { test } from "node:test";
import assert from "node:assert/strict";
import { PtyOutput } from "../lib/pty-output";
import {
  OUTPUT_CHUNK,
  OUTPUT_FRAMES,
  OUTPUT_PENDING_FRAMES,
  OUTPUT_PENDING_LIMIT,
  OUTPUT_WINDOW,
} from "../lib/terminal-protocol";

function setup() {
  const chunks: Buffer[] = [];
  let buffered = 0;
  const events: string[] = [];
  const output = new PtyOutput({
    send: (data) => {
      chunks.push(Buffer.from(data));
    },
    bufferedAmount: () => buffered,
    pause: () => events.push("pause"),
    resume: () => events.push("resume"),
    finish: () => events.push("finish"),
    fail: (reason) => events.push(reason),
  });
  return {
    output,
    chunks,
    events,
    buffer: (value: number) => {
      buffered = value;
    },
  };
}

test("withheld acknowledgments cap in-flight bytes and pause the producer", () => {
  const { output, chunks, events } = setup();
  const text = "語😀\r\n".repeat(20000);
  output.push(text);
  assert.equal(Buffer.concat(chunks).length, OUTPUT_WINDOW);
  assert.equal(output.outstandingBytes, OUTPUT_WINDOW);
  assert.ok(output.pendingBytes > 0);
  assert.ok(chunks.every((chunk) => chunk.length <= OUTPUT_CHUNK));
  assert.deepEqual(events, ["pause"]);
  const first = chunks.length;
  output.acknowledge(OUTPUT_WINDOW);
  assert.ok(chunks.length > first);
  assert.equal(output.pendingBytes, 0);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(text));
  output.acknowledge(Buffer.byteLength(text));
  assert.deepEqual(events, ["pause", "resume"]);
  output.stop();
});

test("small messages cannot grow frame bookkeeping without a bound", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { output, chunks, events } = setup();
  for (let i = 0; i <= OUTPUT_FRAMES; i++) {
    output.push("x");
    t.mock.timers.tick(4);
  }
  assert.equal(chunks.length, OUTPUT_FRAMES);
  assert.equal(output.outstandingFrames, OUTPUT_FRAMES);
  assert.equal(output.pendingBytes, 1);
  assert.deepEqual(events, ["pause"]);
  output.acknowledge(OUTPUT_FRAMES);
  assert.equal(chunks.length, OUTPUT_FRAMES + 1);
  assert.equal(output.outstandingFrames, 1);
  output.stop();
});

test("duplicate and old acknowledgments do not create credit; future ACKs fail", () => {
  const { output, events } = setup();
  output.push("x".repeat(OUTPUT_WINDOW + 10));
  output.acknowledge(10);
  assert.equal(output.outstandingBytes, OUTPUT_WINDOW);
  output.acknowledge(10);
  output.acknowledge(9);
  assert.equal(output.outstandingBytes, OUTPUT_WINDOW);
  assert.equal(output.acknowledge(OUTPUT_WINDOW + 11), false);
  assert.match(events.at(-1)!, /Invalid output acknowledgment/);
  assert.equal(output.pendingBytes, 0);
});

for (const invalid of [-1, 0.5, NaN, Infinity]) {
  test(`invalid ACK ${invalid} cannot resume output`, () => {
    const { output, events } = setup();
    assert.equal(output.acknowledge(invalid), false);
    assert.match(events[0], /Invalid output acknowledgment/);
  });
}

test("socket backlog pauses reading even when browser credit is available", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { output, chunks, events, buffer } = setup();
  buffer(OUTPUT_WINDOW);
  output.push("queued");
  t.mock.timers.tick(4);
  assert.equal(chunks.length, 0);
  assert.deepEqual(events, ["pause"]);
  buffer(0);
  t.mock.timers.tick(16);
  assert.equal(Buffer.concat(chunks).toString(), "queued");
  assert.deepEqual(events, ["pause", "resume"]);
  output.stop();
});

test("late PTY output has a hard pending-buffer limit", () => {
  const { output, chunks, events } = setup();
  output.push("x".repeat(OUTPUT_WINDOW));
  output.push("y".repeat(OUTPUT_PENDING_LIMIT));
  output.push("z");
  assert.equal(Buffer.concat(chunks).length, OUTPUT_WINDOW);
  assert.match(events.at(-1)!, /pending buffer limit/);
  assert.equal(output.pendingBytes, 0);
  output.acknowledge(OUTPUT_WINDOW);
  assert.equal(Buffer.concat(chunks).length, OUTPUT_WINDOW);
});

test("late small PTY chunks cannot exceed the pending frame limit", () => {
  const { output, events } = setup();
  output.push("x".repeat(OUTPUT_WINDOW));
  for (let i = 0; i < OUTPUT_PENDING_FRAMES; i++) output.push("x");
  assert.equal(output.pendingBytes, OUTPUT_PENDING_FRAMES);
  output.push("x");
  assert.match(events.at(-1)!, /pending buffer limit/);
  assert.equal(output.pendingBytes, 0);
});

test("process exit waits for the final byte to be parsed; stop cancels pending work", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { output, events, buffer } = setup();
  output.push("final");
  output.end();
  assert.deepEqual(events, []);
  output.acknowledge(4);
  assert.deepEqual(events, []);
  output.acknowledge(5);
  assert.deepEqual(events, ["finish"]);
  const other = setup();
  other.buffer(OUTPUT_WINDOW);
  other.output.push("cancelled");
  other.output.stop();
  other.buffer(0);
  buffer(0);
  t.mock.timers.runAll();
  assert.equal(other.chunks.length, 0);
  assert.equal(other.output.pendingBytes, 0);
});

test("detached output pauses and replays only missing bytes before pending output", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { output, chunks, events } = setup();
  output.push("first");
  t.mock.timers.tick(4);
  output.acknowledge(2);
  output.push("second");
  t.mock.timers.tick(4);
  output.detach();
  output.push("third");
  assert.equal(output.pendingBytes, 5);
  assert.equal(Buffer.concat(chunks).toString(), "firstsecond");
  assert.equal(output.canResume(1), false);
  assert.equal(output.canResume(12), false);
  // The final ACK was lost; the browser proves it parsed all of 'first'.
  assert.equal(output.attach(5), true);
  assert.equal(Buffer.concat(chunks).toString(), "firstsecondsecondthird");
  output.acknowledge(16);
  assert.equal(output.outstandingBytes, 0);
  assert.deepEqual(events, ["pause", "resume"]);
  output.stop();
});

test("replay respects socket capacity and keeps the original frame bound", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { output, chunks, buffer } = setup();
  for (let i = 0; i < OUTPUT_FRAMES; i++) {
    output.push("x");
    t.mock.timers.tick(4);
  }
  output.detach();
  buffer(OUTPUT_WINDOW);
  assert.equal(output.attach(0), true);
  assert.equal(chunks.length, OUTPUT_FRAMES);
  buffer(0);
  for (let i = 0; i < 4; i++) t.mock.timers.tick(16);
  assert.equal(chunks.length, OUTPUT_FRAMES * 2);
  assert.equal(output.outstandingFrames, OUTPUT_FRAMES);
  output.acknowledge(OUTPUT_FRAMES);
  output.stop();
});

test("fragmented reads coalesce without losing bytes or resetting the deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { output, chunks } = setup();
  t.after(() => output.stop());
  const bytes = Buffer.from("語😀\x1b[31mcolored\x1b[0m\x1b[6n");
  for (let i = 0; i < bytes.length; i++) output.push(bytes.subarray(i, i + 1));
  const expected = Buffer.from(bytes);
  bytes.fill(0);
  t.mock.timers.tick(3);
  output.push("last");
  assert.equal(chunks.length, 0);
  t.mock.timers.tick(1);
  assert.equal(chunks.length, 1);
  assert.deepEqual(
    Buffer.concat(chunks),
    Buffer.concat([expected, Buffer.from("last")]),
  );
  assert.equal(output.pendingBytes, 0);
});

test("ACKs cannot fragment a collecting batch and full frames flush promptly", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { output, chunks } = setup();
  t.after(() => output.stop());
  output.push("previous");
  t.mock.timers.tick(4);
  output.push("a");
  output.acknowledge(8);
  output.push("b");
  assert.equal(chunks.length, 1);
  t.mock.timers.tick(4);
  assert.equal(chunks[1].toString(), "ab");
  output.push("x".repeat(OUTPUT_CHUNK - 1));
  assert.equal(chunks.length, 2);
  output.push("y");
  assert.equal(chunks[2].length, OUTPUT_CHUNK);
  assert.equal(chunks[2].at(-1), 121);
  t.mock.timers.tick(4);
  assert.equal(chunks.length, 3);
});

test("credit can divide a coalesced frame at any byte without corrupting replay", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { output, chunks } = setup();
  t.after(() => output.stop());
  output.push("x".repeat(OUTPUT_WINDOW - 1));
  const suffix = Buffer.from("語😀\x1b[31m!");
  for (const byte of suffix) output.push(Uint8Array.of(byte));
  t.mock.timers.tick(4);
  assert.equal(output.outstandingBytes, OUTPUT_WINDOW);
  assert.equal(output.pendingBytes, suffix.length - 1);
  const before = Buffer.concat(chunks);
  output.detach();
  assert.equal(output.attach(OUTPUT_WINDOW - 2), true);
  const replay = Buffer.concat(chunks).subarray(before.length);
  assert.deepEqual(replay, Buffer.concat([Buffer.from("x"), suffix]));
  output.acknowledge(OUTPUT_WINDOW - 1 + suffix.length);
  assert.equal(output.outstandingBytes, 0);
});

test("detach retains an unsent batch, exit drains it, and stop cancels it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { output, chunks, events } = setup();
  output.push("unsent");
  output.detach();
  t.mock.timers.tick(100);
  assert.equal(chunks.length, 0);
  assert.equal(output.pendingBytes, 6);
  assert.equal(output.attach(0), true);
  assert.equal(Buffer.concat(chunks).toString(), "unsent");
  output.push("final");
  output.end();
  assert.equal(Buffer.concat(chunks).toString(), "unsentfinal");
  assert.ok(!events.includes("finish"));
  output.acknowledge(11);
  assert.equal(events.at(-1), "finish");
  const other = setup();
  other.output.push("cancelled");
  other.output.stop();
  t.mock.timers.runAll();
  assert.equal(other.chunks.length, 0);
});

test("a failed batch send retains every unsent byte for the next attachment", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const chunks: Buffer[] = [];
  let broken = true;
  let disconnected = false;
  const output = new PtyOutput({
    send: (data) => {
      if (broken) throw new Error("Socket lost");
      chunks.push(Buffer.from(data));
    },
    bufferedAmount: () => 0,
    pause: () => {},
    resume: () => {},
    finish: () => {},
    fail: assert.fail,
    disconnect: () => {
      disconnected = true;
    },
  });
  t.after(() => output.stop());
  output.push("first");
  output.push("second");
  t.mock.timers.tick(4);
  assert.equal(disconnected, true);
  assert.equal(output.pendingBytes, 11);
  assert.equal(output.outstandingBytes, 0);
  broken = false;
  assert.equal(output.attach(0), true);
  assert.equal(Buffer.concat(chunks).toString(), "firstsecond");
  output.acknowledge(11);
  assert.equal(output.pendingBytes, 0);
  assert.equal(output.outstandingBytes, 0);
});
