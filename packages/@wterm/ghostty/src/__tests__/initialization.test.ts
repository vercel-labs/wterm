import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
    wasmPath: "https://wterm.test/initialization.wasm",
  });
});

afterEach(() => {
  core.dispose();
  vi.unstubAllGlobals();
});

it("initializes empty cells and row metadata when the same core is reused", () => {
  for (const [cols, rows] of [
    [80, 24],
    [40, 12],
    [100, 30],
    [80, 24],
  ]) {
    core.init(cols, rows);
    expect(core.getCols()).toBe(cols);
    expect(core.getRows()).toBe(rows);
    expect(core.getScrollbackCount()).toBe(0);
    expect(core.getCursor()).toMatchObject({ row: 0, col: 0, visible: true });
    for (let row = 0; row < rows; row++) {
      expect(core.getRowMetadata(row)).toEqual({
        wrapsToNext: false,
        continuesPrevious: false,
      });
      for (let col = 0; col < cols; col++) {
        const cell = core.getCell(row, col);
        expect(cell.char).toBe(32);
        expect(cell.flags).toBe(0);
        expect(cell.chars).toBeUndefined();
        expect(cell.linkUri).toBeUndefined();
        expect(cell.spacerHead).toBeUndefined();
      }
    }
    core.writeString("\x1b[1;32mprevious session\x1b[0m\r\n".repeat(rows + 1));
    expect(core.getScrollbackCount()).toBeGreaterThan(0);
  }
});
