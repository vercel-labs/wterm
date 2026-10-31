import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GhosttyCore } from "../ghostty-core.js";

const wasm = readFileSync(
  new URL("../../wasm/ghostty-vt.wasm", import.meta.url),
);

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(wasm)),
  );
});
afterAll(() => vi.unstubAllGlobals());

const PIECES = [
  "\x1b[m",
  "\x1b[0m",
  "\x1b[1;31m",
  "\x1b[38;2;10;200;30m",
  "\x1b[48;5;208m",
  "\x1b[;4m",
  "\x1b[1;m",
  "\x1b[3;4;9;2;7m",
  "\x1b[123456m",
  "\x1b[70000;1m",
  "\x1b[" + Array.from({ length: 30 }, (_, i) => i % 9).join(";") + "m",
  "\x1b[" + Array.from({ length: 23 }, () => 1).join(";") + "m",
  "\x1b[4:3m",
  "\x1b[?25l",
  "\x1b[?25h",
  "\x1b[2 q",
  "\x1b[5;10H",
  "\x1b[H",
  "\x1b[K",
  "\x1b[2J",
  "\x1b[3D",
  "\x1b]0;title\x07",
  "\x1b7",
  "\x1b8",
  "\x1b(0lqk\x1b(B",
  "plain text ",
  "▀▄█",
  "界語",
  "\u{1F600}",
  "é",
  "\x85",
  "\u0085",
  "\x7f",
  "\xff\xfe",
  "\r\n",
  "\t",
  "\b",
  "\x1b",
  "\x1b[",
  "\x1b[12",
];

function stream(seed: number, length: number): Uint8Array {
  let x = seed;
  const rand = () => (x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < length; i++) {
    const piece = PIECES[Math.floor(rand() * PIECES.length)];
    // "\xff\xfe" and "\x85" stand for raw bytes, not code points.
    parts.push(
      piece === "\xff\xfe"
        ? new Uint8Array([0xff, 0xfe])
        : piece === "\x85"
          ? new Uint8Array([0x85])
          : enc.encode(piece),
    );
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function core() {
  const c = await GhosttyCore.load({
    wasmPath: "https://wterm.test/fast.wasm",
  });
  c.init(30, 8);
  return c;
}

function snapshot(c: GhosttyCore) {
  const cells: unknown[] = [];
  for (let r = 0; r < c.getRows(); r++)
    for (let col = 0; col < c.getCols(); col++) cells.push(c.getCell(r, col));
  return { cells, cursor: c.getCursor(), title: c.getTitle?.() };
}

describe("write fast paths", () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))(
    "matches byte-at-a-time parsing for random stream %i",
    async (seed) => {
      const bytes = stream(seed, 120);
      const whole = await core();
      whole.writeRaw(bytes);
      const stepped = await core();
      for (let i = 0; i < bytes.length; i++)
        stepped.writeRaw(bytes.subarray(i, i + 1));
      expect(snapshot(whole)).toEqual(snapshot(stepped));
      whole.dispose();
      stepped.dispose();
    },
  );
});
