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

test("small messages cannot grow frame bookkeeping without a bound", () => {
  const { output, chunks, events } = setup();
  for (let i = 0; i <= OUTPUT_FRAMES; i++) output.push("x");
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

test("detached output pauses and replays only missing bytes before pending output", () => {
  const { output, chunks, events } = setup();
  output.push("first");
  output.acknowledge(2);
  output.push("second");
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
  for (let i = 0; i < OUTPUT_FRAMES; i++) output.push("x");
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
