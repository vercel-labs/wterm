import type { CellData, WasmBridge } from "@wterm/core";

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const DEFAULT_COLOR = 256;

const FLAG_TO_SGR: Array<[number, string]> = [
  [0x01, `${ESC}1m`],
  [0x02, `${ESC}2m`],
  [0x04, `${ESC}3m`],
  [0x08, `${ESC}4m`],
  [0x10, `${ESC}5m`],
  [0x20, `${ESC}7m`],
  [0x40, `${ESC}8m`],
  [0x80, `${ESC}9m`],
];

type RunStyle = {
  fg: number;
  bg: number;
  flags: number;
};

function isDefaultSpace(cell: CellData): boolean {
  return (
    cell.char === 0x20 &&
    cell.flags === 0 &&
    cell.fg === DEFAULT_COLOR &&
    cell.bg === DEFAULT_COLOR
  );
}

function normalizeChar(codepoint: number): string {
  if (codepoint === 0) return " ";
  return String.fromCodePoint(codepoint);
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.flags === b.flags;
}

export function colorFg(idx: number): string {
  if (idx === DEFAULT_COLOR) return `${ESC}39m`;
  if (idx >= 0 && idx <= 7) return `${ESC}${30 + idx}m`;
  if (idx >= 8 && idx <= 15) return `${ESC}${90 + (idx - 8)}m`;
  return `${ESC}38;5;${idx}m`;
}

export function colorBg(idx: number): string {
  if (idx === DEFAULT_COLOR) return `${ESC}49m`;
  if (idx >= 0 && idx <= 7) return `${ESC}${40 + idx}m`;
  if (idx >= 8 && idx <= 15) return `${ESC}${100 + (idx - 8)}m`;
  return `${ESC}48;5;${idx}m`;
}

export function sgrForRun(_prev: RunStyle | null, cur: RunStyle): string {
  let out = RESET;

  for (const [flag, sgr] of FLAG_TO_SGR) {
    if ((cur.flags & flag) !== 0) out += sgr;
  }

  out += colorFg(cur.fg);
  out += colorBg(cur.bg);

  return out;
}

export function encodeRow(
  _bridge: WasmBridge,
  len: number,
  readCell: (col: number) => CellData,
): string {
  const cells: CellData[] = [];
  for (let col = 0; col < len; col++) {
    cells.push(readCell(col));
  }

  let trimmedLen = cells.length;
  while (trimmedLen > 0 && isDefaultSpace(cells[trimmedLen - 1]!)) {
    trimmedLen--;
  }

  if (trimmedLen === 0) return RESET;

  let out = "";
  let prev: RunStyle | null = null;
  let runStyle: RunStyle | null = null;
  let runText = "";

  for (let col = 0; col < trimmedLen; col++) {
    const cell = cells[col]!;
    const style: RunStyle = { fg: cell.fg, bg: cell.bg, flags: cell.flags };
    const char = normalizeChar(cell.char);

    if (!runStyle) {
      runStyle = style;
      runText = char;
      continue;
    }

    if (sameStyle(runStyle, style)) {
      runText += char;
      continue;
    }

    out += sgrForRun(prev, runStyle) + runText;
    prev = runStyle;
    runStyle = style;
    runText = char;
  }

  if (runStyle) {
    out += sgrForRun(prev, runStyle) + runText;
  }

  out += RESET;
  return out;
}

export function encodeStream(bridge: WasmBridge): string {
  const cursor = bridge.getCursor();
  const rows = bridge.getRows();
  const cols = bridge.getCols();

  let out = "\x1b[2J\x1b[H\x1b[0m";

  const scrollbackCount = bridge.getScrollbackCount();
  for (let i = scrollbackCount - 1; i >= 0; i--) {
    const len = bridge.getScrollbackLineLen(i);
    out += encodeRow(bridge, len, (col) => bridge.getScrollbackCell(i, col));
    out += "\r\n";
  }

  for (let row = 0; row < rows; row++) {
    out += encodeRow(bridge, cols, (col) => bridge.getCell(row, col));
    if (row < rows - 1) out += "\r\n";
  }

  out += "\x1b[0m";
  out += `\x1b[${cursor.row + 1};${cursor.col + 1}H`;
  out += cursor.visible ? "\x1b[?25h" : "\x1b[?25l";

  return out;
}
