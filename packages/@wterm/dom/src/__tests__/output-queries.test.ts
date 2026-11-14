import { describe, expect, it } from "vitest";
import {
  scanWindowSizeBytes,
  scanWindowSizeText,
  type WindowSizeQueryState,
} from "../output-queries.js";

/** Byte-at-a-time reference: every window size query of the whole stream, in order. */
function referenceWindowSizes(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (
      bytes[i] === 0x1b &&
      bytes[i + 1] === 0x5b &&
      bytes[i + 2] === 0x31 &&
      (bytes[i + 3] === 0x34 || bytes[i + 3] === 0x36) &&
      bytes[i + 4] === 0x74
    )
      out.push(bytes[i + 3] === 0x34 ? 14 : 16);
  }
  return out;
}

/** mulberry32 */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  "\x1b[14t",
  "\x1b[16t",
  "\x1b[1m",
  "\x1b[16m",
  "\x1b[38;2;1;14;16m",
  "\x1b]10;?\x07",
  "\x1b]11;?\x1b\\",
  "\x1b]12;?\x07",
  "\x1b",
  "\x1b[",
  "\x1b[1",
  "\x1b]1",
  "14t",
  "t;",
  "1",
  "text ",
  "色",
];

describe("scanWindowSizeBytes", () => {
  it("finds the same queries as a byte-at-a-time scan at any write boundary", () => {
    const next = random(7);
    const encoder = new TextEncoder();
    for (let round = 0; round < 400; round++) {
      let text = "";
      const count = 1 + Math.floor(next() * 40);
      for (let i = 0; i < count; i++)
        text += PIECES[Math.floor(next() * PIECES.length)];
      const bytes = encoder.encode(text);
      const cuts = Array.from({ length: Math.floor(next() * 6) }, () =>
        Math.floor(next() * (bytes.length + 1)),
      ).sort((a, b) => a - b);
      const bounds = [0, ...cuts, bytes.length];
      let state: WindowSizeQueryState = 0;
      const found: number[] = [];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const chunk = bytes.subarray(bounds[k], bounds[k + 1]);
        const result = scanWindowSizeBytes(chunk, state);
        found.push(...result.windowSizes);
        state = result.state;
      }
      expect(found, JSON.stringify({ text, cuts })).toEqual(
        referenceWindowSizes(bytes),
      );
    }
  });

  it("matches the text scan", () => {
    const next = random(11);
    const encoder = new TextEncoder();
    for (let round = 0; round < 200; round++) {
      let text = "";
      for (let i = 0; i < 30; i++)
        text += PIECES[Math.floor(next() * (PIECES.length - 1))];
      const bytes = scanWindowSizeBytes(encoder.encode(text), 0);
      const chars = scanWindowSizeText(text, 0);
      expect(bytes, JSON.stringify(text)).toEqual(chars);
    }
  });
});
