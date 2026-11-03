import { describe, expect, it } from "vitest";
import type { CellData, TerminalCore } from "@wterm/core";
import { GpuGrid } from "../gpu-renderer.js";

const STRIDE = 6;
const COLOR_GLYPH_SLOT = 0x80000000 | 7;
const DECO_COLOR_GLYPH = 4;
const FLAG_UNDERLINE = 0x08;
const FLAG_INVISIBLE = 0x40;

function cell(overrides: Partial<CellData>): CellData {
  return {
    char: 0x1f600,
    fg: 256,
    bg: 256,
    flags: 0,
    width: 2,
    ...overrides,
  } as CellData;
}

/** A grid with its instance buffer and a stub atlas, without a WebGL context. */
function gridFor(cells: CellData[]) {
  const grid = Object.create(GpuGrid.prototype) as GpuGrid;
  const data = new Uint32Array(cells.length * STRIDE);
  Object.assign(grid, {
    cols: cells.length,
    rows: 1,
    data,
    palette: { fg: 0xffffff, bg: 0x000000, cursor: 0xffffff, ansi: [] },
    atlas: { generation: 0, slot: () => COLOR_GLYPH_SLOT },
  });
  const core = {
    getCell: (_row: number, col: number) => cells[col],
  } as unknown as TerminalCore;
  grid.updateRow(core, 0);
  return data;
}

describe("GpuGrid", () => {
  it("draws a visible color glyph from the atlas", () => {
    const data = gridFor([cell({}), cell({ char: 0, width: 0 })]);
    expect(data[3]).toBe(COLOR_GLYPH_SLOT & 0x7fffffff);
    expect((data[4] >>> 16) & DECO_COLOR_GLYPH).toBe(DECO_COLOR_GLYPH);
  });

  it("conceals color glyphs and decorations in invisible cells", () => {
    const data = gridFor([
      cell({ flags: FLAG_INVISIBLE | FLAG_UNDERLINE }),
      cell({ char: 0, width: 0 }),
    ]);
    expect(data[3]).toBe(0);
    expect(data[4]).toBe(0);
  });
});
