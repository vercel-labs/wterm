import { describe, it, expect } from "vitest";
import { Renderer } from "../renderer.js";
import type { CellData, CursorState } from "@wterm/core";

const W = (char: number): CellData => ({
  char,
  fg: 256,
  bg: 256,
  flags: 0,
  width: 2,
});
const CONT: CellData = { char: 0, fg: 256, bg: 256, flags: 0, width: 0 };
const N = (char: number): CellData => ({
  char,
  fg: 256,
  bg: 256,
  flags: 0,
  width: 1,
});

function core(cursorCol: number) {
  const row = [W(0x754c), CONT, N(65), N(66)];
  return {
    getCols: () => 4,
    getRows: () => 1,
    getCell: (_r: number, c: number) => row[c] ?? N(32),
    isDirtyRow: () => true,
    clearDirty: () => {},
    getCursor: (): CursorState => ({ row: 0, col: cursorCol, visible: true }),
    getScrollbackCount: () => 0,
    getScrollbackCell: () => N(32),
    getScrollbackLineLen: () => 0,
  };
}

describe("cursor on a wide cell", () => {
  it("still draws a cursor on a continuation with no wide cell before it", () => {
    const el = document.createElement("div");
    const r = new Renderer(el);
    r.setup(4, 1);
    const stray = {
      getCols: () => 4,
      getRows: () => 1,
      getCell: (_r: number, c: number) => (c === 0 ? CONT : N(65)),
      isDirtyRow: () => true,
      clearDirty: () => {},
      getCursor: (): CursorState => ({ row: 0, col: 0, visible: true }),
      getScrollbackCount: () => 0,
      getScrollbackCell: () => N(32),
      getScrollbackLineLen: () => 0,
    };
    r.render(stray as never);
    expect(el.querySelectorAll(".term-cursor").length).toBe(1);
  });

  it("draws one cursor when it sits on the leading half", () => {
    const el = document.createElement("div");
    const r = new Renderer(el);
    r.setup(4, 1);
    // biome-ignore lint: mock
    r.render(core(0) as never);
    expect(el.querySelectorAll(".term-cursor").length).toBe(1);
  });

  it("draws one cursor when it sits on the continuation half", () => {
    const el = document.createElement("div");
    const r = new Renderer(el);
    r.setup(4, 1);
    // biome-ignore lint: mock
    r.render(core(1) as never);
    expect(el.querySelectorAll(".term-cursor").length).toBe(1);
  });
});
