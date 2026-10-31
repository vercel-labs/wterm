import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhosttyCore } from "../ghostty-core.js";

const wasm = readFileSync(
  new URL("../../wasm/ghostty-vt.wasm", import.meta.url),
);
const hard = { wrapsToNext: false, continuesPrevious: false };
const start = { wrapsToNext: true, continuesPrevious: false };
const middle = { wrapsToNext: true, continuesPrevious: true };
const end = { wrapsToNext: false, continuesPrevious: true };
let core: GhosttyCore;

beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(wasm)),
  );
  core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/ghostty.wasm",
  });
  core.init(6, 4);
});

afterEach(() => {
  core.dispose();
  vi.unstubAllGlobals();
});

function rows() {
  return Array.from({ length: core.getRows() }, (_, row) =>
    core.getRowMetadata(row),
  );
}

describe("Ghostty row metadata", () => {
  it("returns unknown metadata before initialization", async () => {
    const uninitialized = await GhosttyCore.load({
      wasmPath: "https://wterm.test/ghostty.wasm",
    });
    expect(uninitialized.getRowMetadata(0)).toBeNull();
    expect(uninitialized.getScrollbackRowMetadata(0)).toBeNull();
    uninitialized.dispose();
  });

  it("distinguishes a pending wrap from an actual soft wrap before rendering", () => {
    core.writeString("abcdef");
    expect(core.getRowMetadata(0)).toEqual(hard);
    core.writeString("g");
    expect(rows()).toEqual([start, end, hard, hard]);
  });

  it("preserves an explicit newline at the right edge", () => {
    core.writeString("abcdef\r\ng");
    expect(rows()).toEqual([hard, hard, hard, hard]);
  });

  it("reports wide-character wraps before the final column", () => {
    core.writeString("abcde界");
    expect(rows()).toEqual([start, end, hard, hard]);
    expect(core.getCell(1, 0).width).toBe(2);
  });

  it("keeps wrap relationships across the live/history boundary and vertical resize", () => {
    core.writeString("abcdefghijklmno\r\nlast");
    expect(rows()).toEqual([start, middle, end, hard]);
    core.resize(6, 2);
    expect(core.getScrollbackCount()).toBe(2);
    expect(core.getScrollbackRowMetadata(0)).toEqual(middle);
    expect(core.getScrollbackRowMetadata(1)).toEqual(start);
    expect(rows()).toEqual([end, hard]);
    core.resize(6, 4);
    expect(core.getScrollbackCount()).toBe(0);
    expect(rows()).toEqual([start, middle, end, hard]);
  });

  it("recomputes wraps after narrower and wider reflow without mutating snapshots", () => {
    core.writeString("abcdefghijklmn");
    const snapshot = core.getRowMetadata(1);
    expect(rows()).toEqual([start, middle, end, hard]);
    core.resize(4, 4);
    expect(rows()).toEqual([start, middle, middle, end]);
    core.resize(12, 4);
    expect(rows()).toEqual([start, end, hard, hard]);
    expect(snapshot).toEqual(middle);
  });

  it("reads scrollback in newest-first order after output scrolls", () => {
    core.writeString("abcdefghijklmno\r\nlast\r\n");
    expect(core.getScrollbackRowMetadata(0)).toEqual(start);
    expect(rows()).toEqual([middle, end, hard, hard]);
    core.writeString("\r\n");
    expect(core.getScrollbackRowMetadata(0)).toEqual(middle);
    expect(core.getScrollbackRowMetadata(1)).toEqual(start);
    expect(core.getScrollbackRowMetadata(2)).toBeNull();
  });

  it("keeps primary and alternate screen metadata separate and clears erased rows", () => {
    core.writeString("abcdefghijklmno\r\nlast\r\n");
    core.writeString("\x1b[?1049h\x1b[H");
    expect(rows()).toEqual([hard, hard, hard, hard]);
    expect(core.getScrollbackRowMetadata(0)).toBeNull();
    core.writeString("1234567");
    expect(rows()).toEqual([start, end, hard, hard]);
    core.writeString("\x1b[?1049l");
    expect(rows()).toEqual([middle, end, hard, hard]);
    expect(core.getScrollbackRowMetadata(0)).toEqual(start);
    core.writeString("\x1b[2J\x1b[H");
    expect(rows()).toEqual([hard, hard, hard, hard]);
  });

  it("does not wrap when autowrap is disabled", () => {
    core.writeString("\x1b[?7labcdefghijk");
    expect(rows()).toEqual([hard, hard, hard, hard]);
  });

  it("preserves continuation at the oldest retained row after history is pruned", async () => {
    core.dispose();
    core = await GhosttyCore.load({
      wasmPath: "https://wterm.test/ghostty.wasm",
      scrollbackLimit: 1024,
    });
    core.init(6, 4);
    core.writeString("x".repeat(120000));
    expect(core.getScrollbackDiscardedCount()).toBeGreaterThan(0);
    const count = core.getScrollbackCount();
    expect(count).toBeGreaterThan(0);
    expect(core.getScrollbackRowMetadata(count - 1)).toEqual(middle);
    expect(core.getScrollbackRowMetadata(count)).toBeNull();
  });

  it("returns null for invalid positions, reset history, and disposed cores", () => {
    core.writeString("abcdefghijklmno\r\nlast\r\n");
    for (const index of [-1, 0.5, NaN, Infinity, 2 ** 32 - 1, 2 ** 32]) {
      expect(core.getRowMetadata(index)).toBeNull();
      expect(core.getScrollbackRowMetadata(index)).toBeNull();
    }
    expect(core.getRowMetadata(4)).toBeNull();
    core.init(6, 4);
    expect(rows()).toEqual([hard, hard, hard, hard]);
    expect(core.getScrollbackRowMetadata(0)).toBeNull();
    core.dispose();
    expect(core.getRowMetadata(0)).toBeNull();
    expect(core.getScrollbackRowMetadata(0)).toBeNull();
  });
});
