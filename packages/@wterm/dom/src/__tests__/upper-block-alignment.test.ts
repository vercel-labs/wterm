import { describe, it, expect, beforeEach } from "vitest";
import { Renderer } from "../renderer.js";
import type { CellData, CursorState } from "@wterm/core";

/**
 * Regression coverage for the U+2594 (UPPER ONE EIGHTH BLOCK) horizontal-rule
 * alignment bug observed when wterm renders Claude Code's TUI.
 *
 * Claude Code draws horizontal rules as a run of U+2594 cells. The DOM
 * renderer paints these via a CSS linear-gradient on a `.term-block` span.
 * The original implementation used `linear-gradient(<fg> 12.5%, <bg> 12.5%)`,
 * which at the canonical row-height of 17px resolves to a 2.125px stop —
 * a sub-pixel boundary the browser must round inconsistently from cell to
 * cell, producing the visible jog at every cell boundary and 1px gaps /
 * overlaps with the row below.
 *
 * The fix snaps the gradient stop to a whole-pixel boundary using CSS
 * `round()` against the `--term-row-height` custom property, so every cell
 * paints the eighth-block at the same physical pixel and the row directly
 * below sits flush against it.
 *
 * These tests assert on the emitted CSS string because jsdom / happy-dom
 * do no real layout — pixel-level assertions are not possible without a
 * real browser. Pixel rendering is exercised via the e2e suite.
 */

function createMockBridge(cols: number, rows: number, grid: CellData[][] = []) {
  const dirtyRows = new Set<number>();
  for (let r = 0; r < rows; r++) dirtyRows.add(r);

  return {
    getCols: () => cols,
    getRows: () => rows,
    getCell: (row: number, col: number): CellData =>
      grid[row]?.[col] ?? { char: 0, fg: 256, bg: 256, flags: 0 },
    isDirtyRow: (row: number) => dirtyRows.has(row),
    clearDirty: () => dirtyRows.clear(),
    getCursor: (): CursorState => ({ row: 1, col: 0, visible: false }),
    getScrollbackCount: () => 0,
    getScrollbackCell: (_offset: number, _col: number): CellData => ({
      char: 0,
      fg: 256,
      bg: 256,
      flags: 0,
    }),
    getScrollbackLineLen: () => 0,
  };
}

function makeCell(char: string, fg = 256, bg = 256, flags = 0): CellData {
  return { char: char.codePointAt(0)!, fg, bg, flags };
}

describe("U+2594 horizontal-rule alignment (Claude Code TUI)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("renders U+2594 cells with a pixel-snapped gradient stop, not a sub-pixel %", () => {
    // Five U+2594 cells across row 0; five U+2502 (vertical bar) on row 1
    // at the same columns. This is the exact pattern Claude Code emits for
    // a horizontal rule followed by box-drawing.
    const upper = makeCell("▔");
    const vbar = makeCell("│");
    const grid: CellData[][] = [
      [upper, upper, upper, upper, upper],
      [vbar, vbar, vbar, vbar, vbar],
    ];
    const bridge = createMockBridge(5, 2, grid);
    const renderer = new Renderer(container);
    renderer.render(bridge as any);

    const blocks = container.querySelectorAll(".term-block");
    expect(blocks).toHaveLength(5);

    // Every block span must carry a background gradient.
    for (const block of Array.from(blocks)) {
      const style = block.getAttribute("style") ?? "";
      expect(style).toMatch(/linear-gradient\(/);
    }

    // The sub-pixel `12.5%` stop is the bug — after the fix, no block
    // span should emit a percentage-based vertical gradient stop for
    // U+2594. The stop must be expressed in a length that snaps to a
    // whole pixel (e.g. via `round(... , 1px)` or a px-typed calc).
    const firstStyle = blocks[0].getAttribute("style") ?? "";
    expect(
      firstStyle,
      "U+2594 gradient stop must be pixel-snapped, not the sub-pixel 12.5% that caused the alignment jog",
    ).not.toMatch(/\b12\.5%/);

    // Positive assertion: a pixel-typed stop appears (either `round(...)`
    // or an explicit `px` length). Either keeps the gradient stop on a
    // device pixel.
    expect(firstStyle).toMatch(/round\(|\bpx\b/);

    // All five U+2594 cells must share an identical background string so
    // adjacent cells paint at the same pixel — any divergence reintroduces
    // the per-cell jog symptom.
    const styles = Array.from(blocks).map((b) => b.getAttribute("style"));
    for (let i = 1; i < styles.length; i++) {
      expect(styles[i]).toBe(styles[0]);
    }
  });

  it("U+2594 spans inherit the .term-row > span vertical-align rule (no baseline jog)", () => {
    // The .term-row > span selector in terminal.css sets vertical-align: top
    // on every child span. Confirm the U+2594 span is a plain <span> that
    // the selector matches, not a different element type. (jsdom doesn't
    // resolve computed styles from stylesheets, so we verify the structural
    // contract the CSS depends on.)
    const grid: CellData[][] = [[makeCell("▔"), makeCell("▔")]];
    const bridge = createMockBridge(2, 1, grid);
    const renderer = new Renderer(container);
    renderer.render(bridge as any);

    const row = container.querySelector(".term-row");
    expect(row).not.toBeNull();
    const directSpanChildren = row?.querySelectorAll(":scope > span");
    expect(directSpanChildren?.length).toBeGreaterThan(0);
    for (const child of Array.from(directSpanChildren ?? [])) {
      expect(child.tagName).toBe("SPAN");
      expect(child.classList.contains("term-block")).toBe(true);
    }
  });
});
