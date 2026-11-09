import { afterEach, describe, expect, it, vi } from "vitest";
import { Renderer } from "../renderer.js";
import type { CellData, CursorState } from "@wterm/core";

/** Advances of the fake canvas font, keyed by text; bold is wider for é. */
const ADVANCES: Record<string, number> = {
  W: 8,
  a: 8,
  c: 8,
  f: 8,
  é: 8,
  Ǆ: 10,
  中: 14,
  文: 14,
  字: 14,
  "😀": 17,
};

function stubCanvas(cellAdvance = 8) {
  const measured: string[] = [];
  class FakeOffscreenCanvas {
    getContext() {
      return {
        font: "",
        fontKerning: "auto",
        measureText(text: string) {
          measured.push(text);
          const bold = this.font.includes("bold");
          if (text === "W") return { width: cellAdvance };
          return {
            width: (ADVANCES[text] ?? 8) + (bold && text === "é" ? 1 : 0),
          };
        },
      };
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  return measured;
}

function cellsOf(text: string, flags = 0): CellData[] {
  const cells: CellData[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const wide = cp >= 0x4e00 || cp >= 0x1f000;
    cells.push({ char: cp, fg: 256, bg: 256, flags, width: wide ? 2 : 1 });
    if (wide) cells.push({ char: 0, fg: 256, bg: 256, flags, width: 0 });
  }
  return cells;
}

function render(cells: CellData[], cursor: CursorState) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const bridge = {
    getCols: () => cells.length,
    getRows: () => 1,
    getCell: (_row: number, col: number) => cells[col],
    isDirtyRow: () => true,
    clearDirty: () => {},
    getCursor: () => cursor,
    getScrollbackCount: () => 0,
    getScrollbackCell: () => cells[0],
    getScrollbackLineLen: () => 0,
  };
  new Renderer(container).render(bridge, {
    scrollTop: 0,
    clientHeight: 17,
    rowHeight: 17,
    charWidth: 8,
  });
  const row = container.querySelector<HTMLElement>(".term-row")!;
  return Array.from(row.children as HTMLCollectionOf<HTMLElement>).map(
    (span) => [
      span.textContent,
      span.style.getPropertyValue("--term-span-cols") || "1",
      span.style.letterSpacing,
    ],
  );
}

const hidden = { row: 0, col: 0, visible: false };

describe("measured glyph runs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps letters that advance like ASCII in the text run", () => {
    stubCanvas();
    expect(render(cellsOf("café Ǆa"), hidden)).toEqual([
      ["café ", "5", ""],
      ["Ǆ", "1", ""],
      ["a", "1", ""],
    ]);
  });

  it("measures bold glyphs in the bold font", () => {
    stubCanvas();
    expect(render(cellsOf("café", 0x01), hidden)).toEqual([
      ["caf", "3", ""],
      ["é", "1", ""],
    ]);
  });

  it("pads a run of wide glyphs with one advance to their cells", () => {
    stubCanvas();
    expect(render(cellsOf("中文字😀a"), hidden)).toEqual([
      ["中文字", "6", "2px"],
      ["😀", "1", ""],
      ["a", "1", ""],
    ]);
  });

  it("ends a wide run at the cursor", () => {
    stubCanvas();
    expect(
      render(cellsOf("中文字a"), { row: 0, col: 4, visible: true }),
    ).toEqual([
      ["中文", "4", "2px"],
      ["字", "1", ""],
      ["a", "1", ""],
    ]);
  });

  it("bounds every glyph when the canvas font does not match the cells", () => {
    const measured = stubCanvas(10);
    expect(render(cellsOf("éa中文"), hidden)).toEqual([
      ["é", "1", ""],
      ["a", "1", ""],
      ["中", "1", ""],
      ["文", "1", ""],
    ]);
    expect(measured).toEqual(["W"]);
  });
});
