import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GhosttyCore } from "../ghostty-core.js";

const wasm = readFileSync(
  new URL("../../wasm/ghostty-vt.wasm", import.meta.url),
);
let core: GhosttyCore;
beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(wasm)),
  );
  core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/tracked.wasm",
    scrollbackLimit: 1024,
  });
  core.init(6, 4);
});
afterEach(() => {
  core.dispose();
  vi.unstubAllGlobals();
});

it("follows a cell through reflow and output moving into history", () => {
  core.writeString("abcdefghijklmn");
  const position = core.trackPosition({ row: 1, col: 2 })!;
  expect(position.resolve()).toEqual({ row: 1, col: 2 });
  core.resize(4, 4);
  expect(position.resolve()).toEqual({ row: 2, col: 0 });
  core.resize(12, 4);
  expect(position.resolve()).toEqual({ row: 0, col: 8 });
  core.writeString("\r\nnext\r\nnext\r\nnext\r\n");
  expect(position.resolve()).toEqual({ row: 0, col: 8 });
  expect(core.getScrollbackCount()).toBeGreaterThan(0);
  position.dispose();
  position.dispose();
  expect(position.resolve()).toBeNull();
});

it("rejects invalid coordinates and bounds simultaneous handles", () => {
  for (const bad of [-1, 0.5, NaN, Infinity, 2 ** 32]) {
    expect(core.trackPosition({ row: bad, col: 0 })).toBeNull();
    expect(core.trackPosition({ row: 0, col: bad })).toBeNull();
  }
  expect(core.trackPosition({ row: 4, col: 0 })).toBeNull();
  expect(core.trackPosition({ row: 0, col: 6 })).toBeNull();
  const positions = Array.from({ length: 64 }, () =>
    core.trackPosition({ row: 0, col: 0 })!,
  );
  expect(positions.every(Boolean)).toBe(true);
  expect(core.trackPosition({ row: 0, col: 0 })).toBeNull();
  positions[0].dispose();
  expect(core.trackPosition({ row: 0, col: 1 })?.resolve()).toEqual({
    row: 0,
    col: 1,
  });
  expect(positions[0].resolve()).toBeNull();
});

it("invalidates on pruning, screen switches within one write, reset and reinitialization", () => {
  const position = core.trackPosition({ row: 0, col: 0 })!;
  core.writeString("x\r\n".repeat(20000));
  expect(core.getScrollbackDiscardedCount()).toBeGreaterThan(0);
  expect(position.resolve()).toBeNull();
  position.dispose();
  const fresh = () =>
    core.trackPosition({ row: core.getScrollbackCount(), col: 0 })!;
  const switched = fresh();
  core.writeString("\x1b[?1049h\x1b[?1049l");
  expect(switched.resolve()).toBeNull();
  core.writeString("\x1b[?1049h");
  const alternate = fresh();
  core.writeString("\x1bc");
  expect(alternate.resolve()).toBeNull();
  switched.dispose();
  alternate.dispose();
  const reset = fresh();
  core.init(6, 4);
  expect(reset.resolve()).toBeNull();
  const disposed = fresh();
  reset.dispose();
  expect(disposed.resolve()).not.toBeNull();
  core.dispose();
  expect(disposed.resolve()).toBeNull();
});

it("returns null when an older binary does not expose tracking", () => {
  const internal = core as unknown as {
    wasm: import("../wasm-bindings.js").GhosttyWasm;
  };
  internal.wasm = {
    ...internal.wasm,
    exports: { ...internal.wasm.exports, track_position: undefined },
  };
  expect(core.trackPosition({ row: 0, col: 0 })).toBeNull();
});
