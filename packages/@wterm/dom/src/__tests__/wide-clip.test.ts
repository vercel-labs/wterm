import { describe, it, expect } from "vitest";
import { Renderer } from "../renderer.js";
import type { CellData, CursorState } from "@wterm/core";

const N = (ch: number): CellData => ({
  char: ch,
  fg: 256,
  bg: 256,
  flags: 0,
  width: 1,
});
const W = (ch: number): CellData => ({
  char: ch,
  fg: 256,
  bg: 256,
  flags: 0,
  width: 2,
});
const C: CellData = { char: 0, fg: 256, bg: 256, flags: 0, width: 0 };

describe("wide cell at the clip boundary of a scrollback row", () => {
  it("does not spill a second column past the row", () => {
    // Stored at width 6 with the pair at 3..4, rendered in a 4-column grid.
    const stored = [N(97), N(98), N(99), W(0x754c), C, N(32)];
    const el = document.createElement("div");
    const r = new Renderer(el);
    r.setup(4, 1);
    r.render({
      getCols: () => 4,
      getRows: () => 1,
      getCell: () => N(32),
      isDirtyRow: () => true,
      clearDirty: () => {},
      getCursor: (): CursorState => ({ row: 0, col: 0, visible: false }),
      getScrollbackCount: () => 1,
      getScrollbackCell: (_o: number, c: number) => stored[c] ?? N(32),
      getScrollbackLineLen: () => stored.length,
    } as never);

    const sb = el.querySelector(".term-scrollback-row");
    expect(sb?.querySelectorAll(".term-wide").length).toBe(0);
    expect(sb?.textContent).toBe("abc ");
  });

  it("keeps a spacer-head column that follows a narrow cell", () => {
    const HEAD: CellData = { char: 32, fg: 256, bg: 256, flags: 0, width: 0 };
    const row = [N(49), N(50), N(51), N(52), HEAD];
    const el = document.createElement("div");
    const r = new Renderer(el);
    r.setup(5, 1);
    r.render({
      getCols: () => 5,
      getRows: () => 1,
      getCell: (_r: number, c: number) => row[c] ?? N(32),
      isDirtyRow: () => true,
      clearDirty: () => {},
      getCursor: (): CursorState => ({ row: 0, col: 0, visible: false }),
      getScrollbackCount: () => 0,
      getScrollbackCell: () => N(32),
      getScrollbackLineLen: () => 0,
    } as never);
    expect(el.querySelector(".term-row")?.textContent).toBe("1234 ");
  });
});
