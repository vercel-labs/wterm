import { describe, it, expect } from "vitest";
import { colorBg, colorFg, encodeRow, encodeStream } from "../encode.js";

type Cell = { char: number; fg: number; bg: number; flags: number };

type FakeBridge = {
  getCursor: () => { row: number; col: number; visible: boolean };
  getRows: () => number;
  getCols: () => number;
  getScrollbackCount: () => number;
  getScrollbackLineLen: (offset: number) => number;
  getScrollbackCell: (offset: number, col: number) => Cell;
  getCell: (row: number, col: number) => Cell;
};

function makeCell(ch: string, overrides: Partial<Cell> = {}): Cell {
  return {
    char: ch.codePointAt(0) ?? 0,
    fg: 256,
    bg: 256,
    flags: 0,
    ...overrides,
  };
}

function bridgeForRow(row: Cell[]): FakeBridge {
  return {
    getCursor: () => ({ row: 0, col: 0, visible: true }),
    getRows: () => 1,
    getCols: () => row.length,
    getScrollbackCount: () => 0,
    getScrollbackLineLen: () => 0,
    getScrollbackCell: () => makeCell(" "),
    getCell: (_r: number, c: number) => row[c] ?? makeCell(" "),
  };
}

describe("encodeStream", () => {
  it("emits clear-home-reset prologue", () => {
    const bridge = bridgeForRow([makeCell("A")]);
    const out = encodeStream(bridge as any);
    expect(out.startsWith("\x1b[2J\x1b[H\x1b[0m")).toBe(true);
  });

  it("plain ASCII row encodes text and trims trailing default spaces", () => {
    const row = [makeCell("H"), makeCell("i"), makeCell(" "), makeCell(" ")];
    const bridge = bridgeForRow(row);

    const out = encodeStream(bridge as any);
    expect(out).toContain("Hi");
    expect(out).not.toContain("Hi  ");
  });

  it("BOLD flag emits ESC[1m", () => {
    const out = encodeRow({} as any, 1, () => makeCell("B", { flags: 0x01 }));
    expect(out).toContain("\x1b[1m");
  });

  it("ITALIC emits ESC[3m", () => {
    const out = encodeRow({} as any, 1, () => makeCell("I", { flags: 0x04 }));
    expect(out).toContain("\x1b[3m");
  });

  it("REVERSE emits ESC[7m", () => {
    const out = encodeRow({} as any, 1, () => makeCell("R", { flags: 0x20 }));
    expect(out).toContain("\x1b[7m");
  });

  it("STRIKETHROUGH emits ESC[9m", () => {
    const out = encodeRow({} as any, 1, () => makeCell("S", { flags: 0x80 }));
    expect(out).toContain("\x1b[9m");
  });

  it("fg 0..7 uses 30+i, fg 8..15 uses 90+(i-8), fg 16..255 uses 38;5;N, fg 256 uses 39", () => {
    expect(colorFg(1)).toBe("\x1b[31m");
    expect(colorFg(10)).toBe("\x1b[92m");
    expect(colorFg(196)).toBe("\x1b[38;5;196m");
    expect(colorFg(256)).toBe("\x1b[39m");
  });

  it("bg 0..7 uses 40+i, bg 8..15 uses 100+(i-8), bg 16..255 uses 48;5;N, bg 256 uses 49", () => {
    expect(colorBg(2)).toBe("\x1b[42m");
    expect(colorBg(11)).toBe("\x1b[103m");
    expect(colorBg(201)).toBe("\x1b[48;5;201m");
    expect(colorBg(256)).toBe("\x1b[49m");
  });

  it("emits ESC[0m at end of each row", () => {
    const out = encodeRow({} as any, 1, () => makeCell("X"));
    expect(out.endsWith("\x1b[0m")).toBe(true);
  });
});
