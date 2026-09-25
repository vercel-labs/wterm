import type { CellData, TerminalCore, TerminalPosition } from "@wterm/core";

export const MAX_SELECTION_ROWS = 1000;
export const MAX_SELECTION_TEXT = 1024 * 1024;

export type SelectionUnit = "word" | "line";
/** Both edges include the complete cell at their coordinates. */
export interface SelectionRange {
  start: TerminalPosition;
  end: TerminalPosition;
}

// Ghostty's default word boundaries. Paths, hyphens, dots and Unicode text
// remain together; adjacent boundary characters form a separate run.
const WORD_BOUNDARIES = new Set(" \t'\"│`|:;,()[]{}<>$");

/** Expand in retained-buffer coordinates without joining hard/unknown breaks. */
export function selectionRange(
  core: TerminalCore,
  position: TerminalPosition,
  unit: SelectionUnit,
): SelectionRange | null {
  const history = core.getScrollbackCount();
  const total = history + core.getRows();
  const cols = core.getCols();
  const blank: CellData = { char: 0, fg: 256, bg: 256, flags: 0 };
  if (
    !Number.isInteger(position.row) ||
    !Number.isInteger(position.col) ||
    position.row < 0 ||
    position.row >= total ||
    position.col < 0 ||
    position.col >= cols
  )
    return null;
  const cell = (p: TerminalPosition) =>
    p.row < history
      ? p.col < core.getScrollbackLineLen(history - p.row - 1)
        ? core.getScrollbackCell(history - p.row - 1, p.col)
        : blank
      : core.getCell(p.row - history, p.col);
  const metadata = (row: number) =>
    row < history
      ? core.getScrollbackLineLen(history - row - 1) <= cols
        ? core.getScrollbackRowMetadata?.(history - row - 1)
        : null
      : core.getRowMetadata?.(row - history);
  const wraps = (row: number) =>
    row >= 0 &&
    row + 1 < total &&
    metadata(row)?.wrapsToNext &&
    metadata(row + 1)?.continuesPrevious;
  const advance = (
    p: TerminalPosition,
    direction: -1 | 1,
  ): TerminalPosition | null => {
    const col = p.col + direction;
    if (col >= 0 && col < cols) return { row: p.row, col };
    const row = p.row + direction;
    if (!wraps(Math.min(row, p.row))) return null;
    return { row, col: direction === 1 ? 0 : cols - 1 };
  };
  let origin = { ...position };
  // Either half of a wide cell selects its leading grapheme. A spacer head
  // has no text to select; let the browser handle that empty hit instead.
  if (cell(origin).spacerHead) return null;
  if (cell(origin).width === 0 && origin.col > 0) origin.col--;
  const text = (p: TerminalPosition) => {
    const value = cell(p);
    return value.chars ?? String.fromCodePoint(value.char || 32);
  };
  const boundary = (text: string) =>
    WORD_BOUNDARIES.has(String.fromCodePoint(text.codePointAt(0) ?? 32));
  const expected = boundary(text(origin));
  let length = text(origin).length;
  let reads = 1;
  let exceeded = length > MAX_SELECTION_TEXT;
  let start = origin,
    end = origin;
  const expand = (direction: -1 | 1) => {
    let current = origin;
    let included = origin;
    while (true) {
      const next = advance(current, direction);
      if (!next) return included;
      if (++reads > 2 * MAX_SELECTION_TEXT) {
        exceeded = true;
        return included;
      }
      const value = cell(next);
      if (value.width !== 0 && !value.spacerHead) {
        const chars = value.chars ?? String.fromCodePoint(value.char || 32);
        if (unit === "word" && boundary(chars) !== expected) return included;
        length += chars.length;
        included = next;
      }
      const first = direction === -1 ? next.row : start.row;
      const last = direction === 1 ? next.row : origin.row;
      if (last - first >= MAX_SELECTION_ROWS || length > MAX_SELECTION_TEXT) {
        exceeded = true;
        return included;
      }
      current = next;
    }
  };
  start = expand(-1);
  if (!exceeded) end = expand(1);
  return exceeded ? null : { start, end };
}
