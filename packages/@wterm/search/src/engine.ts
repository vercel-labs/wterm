import type { SearchMatch, SearchOptions } from "./index.js";

export interface BridgeLike {
  getScrollbackCount(): number;
  getScrollbackLineLen(offset: number): number;
  getScrollbackCell(
    offset: number,
    col: number,
  ): {
    char: number;
    fg: number;
    bg: number;
    flags: number;
  };
  getRows(): number;
  getCols(): number;
  getCell(
    row: number,
    col: number,
  ): {
    char: number;
    fg: number;
    bg: number;
    flags: number;
  };
}

export interface RowText {
  row: number;
  text: string;
  trimmedLen: number;
}

const DEFAULT_COLOR = 256;
const DEFAULT_SPACE = 0x20;
const MAX_SCAN_MATCHES = 50000;

function isDefaultSpaceCell(cell: {
  char: number;
  fg: number;
  bg: number;
  flags: number;
}): boolean {
  return (
    cell.char === DEFAULT_SPACE &&
    cell.flags === 0 &&
    cell.fg === DEFAULT_COLOR &&
    cell.bg === DEFAULT_COLOR
  );
}

function readLine(
  len: number,
  getCell: (col: number) => {
    char: number;
    fg: number;
    bg: number;
    flags: number;
  },
): { text: string; trimmedLen: number } {
  const chars: string[] = new Array(len);
  const cells = new Array(len);

  for (let col = 0; col < len; col++) {
    const cell = getCell(col);
    cells[col] = cell;
    chars[col] = String.fromCodePoint(cell.char || DEFAULT_SPACE);
  }

  let trimmedLen = len;
  while (trimmedLen > 0 && isDefaultSpaceCell(cells[trimmedLen - 1]!)) {
    trimmedLen--;
  }

  return {
    text: chars.slice(0, trimmedLen).join(""),
    trimmedLen,
  };
}

export function* iterRows(bridge: BridgeLike): IterableIterator<RowText> {
  const sbCount = bridge.getScrollbackCount();

  for (let i = sbCount - 1; i >= 0; i--) {
    const row = -(i + 1);
    const len = bridge.getScrollbackLineLen(i);
    const line = readLine(len, (col) => bridge.getScrollbackCell(i, col));
    yield { row, text: line.text, trimmedLen: line.trimmedLen };
  }

  const rows = bridge.getRows();
  const cols = bridge.getCols();

  for (let row = 0; row < rows; row++) {
    const line = readLine(cols, (col) => bridge.getCell(row, col));
    yield { row, text: line.text, trimmedLen: line.trimmedLen };
  }
}

function escapeRegexLiteral(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileMatcher(
  query: string,
  opts: SearchOptions = {},
): RegExp {
  const sourceBase = opts.regex ? query : escapeRegexLiteral(query);
  const source = opts.wholeWord ? `\\b(?:${sourceBase})\\b` : sourceBase;
  const flags = opts.caseSensitive ? "g" : "gi";

  try {
    return new RegExp(source, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`wterm: invalid search pattern: ${message}`);
  }
}

export function findAllMatches(
  bridge: BridgeLike,
  matcher: RegExp,
  limit = MAX_SCAN_MATCHES,
): SearchMatch[] {
  const matches: SearchMatch[] = [];

  for (const row of iterRows(bridge)) {
    matcher.lastIndex = 0;

    while (true) {
      const match = matcher.exec(row.text);
      if (!match) break;

      matches.push({
        row: row.row,
        col: match.index,
        length: match[0].length,
        text: match[0],
      });

      if (matches.length >= limit) {
        return matches;
      }

      if (matcher.lastIndex === match.index) {
        matcher.lastIndex++;
      }
    }
  }

  return matches;
}

export function getMaxScanMatches(): number {
  return MAX_SCAN_MATCHES;
}
