import type { TerminalCore, TerminalPosition } from "@wterm/core";
import { MAX_SELECTION_ROWS, MAX_SELECTION_TEXT } from "./selection-range.js";

const MAX_RECTANGLE_CELLS = 65536;

export interface RectangleSelection {
  text: string;
  rows: { row: number; left: number; right: number }[];
}

/** Inclusive corners in physical rows; wide glyphs at either edge stay whole. */
export function rectangleSelection(
  core: TerminalCore,
  start: TerminalPosition,
  end: TerminalPosition,
): RectangleSelection | null {
  const history = core.getScrollbackCount();
  const total = history + core.getRows();
  const cols = core.getCols();
  for (const point of [start, end]) {
    if (
      !Number.isInteger(point.row) ||
      !Number.isInteger(point.col) ||
      point.row < 0 ||
      point.row >= total ||
      point.col < 0 ||
      point.col >= cols
    )
      return null;
  }
  const top = Math.min(start.row, end.row),
    bottom = Math.max(start.row, end.row);
  const left = Math.min(start.col, end.col),
    right = Math.max(start.col, end.col);
  const count = bottom - top + 1;
  if (
    count > MAX_SELECTION_ROWS ||
    count * (right - left + 2) > MAX_RECTANGLE_CELLS
  )
    return null;
  const rows: RectangleSelection["rows"] = [];
  const text: string[] = [];
  let length = count - 1;
  for (let row = top; row <= bottom; row++) {
    const offset = history - row - 1;
    const width = row < history ? core.getScrollbackLineLen(offset) : cols;
    const cell = (col: number) =>
      col >= width
        ? null
        : row < history
          ? core.getScrollbackCell(offset, col)
          : core.getCell(row - history, col);
    let first = left;
    if (first > 0 && cell(first)?.width === 0 && cell(first - 1)?.width === 2)
      first--;
    let last = right + 1;
    let line = "";
    for (let col = first; col <= right; col++) {
      const value = cell(col);
      if (value?.width === 0 || value?.spacerHead) continue;
      const chars = value?.chars ?? String.fromCodePoint(value?.char || 32);
      length += chars.length;
      if (length > MAX_SELECTION_TEXT) return null;
      line += chars;
      last = Math.max(last, Math.min(cols, col + (value?.width ?? 1)));
    }
    rows.push({ row, left: first, right: last });
    text.push(line);
  }
  return { rows, text: text.join("\n") };
}
