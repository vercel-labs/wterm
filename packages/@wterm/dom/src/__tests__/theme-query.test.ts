import { describe, it, expect } from "vitest";
import {
  ThemeQueryScanner,
  THEME_BACKGROUND,
  THEME_FOREGROUND,
} from "../theme-query.js";

const BOTH = THEME_FOREGROUND | THEME_BACKGROUND;

/** The theme colors `parts` ask for when they are written one after another. */
function scan(parts: (string | Uint8Array)[]): number {
  const scanner = new ThemeQueryScanner();
  let colors = 0;
  for (const part of parts) colors |= scanner.scan(part);
  return colors;
}

/** Every way to cut `data` into two writes. */
function splits(data: string): string[][] {
  const parts: string[][] = [];
  for (let i = 1; i < data.length; i++)
    parts.push([data.slice(0, i), data.slice(i)]);
  return parts;
}

function bytes(data: string): Uint8Array {
  return new TextEncoder().encode(data);
}

describe("ThemeQueryScanner", () => {
  it("recognizes the theme color queries the cores answer", () => {
    expect(scan(["\x1b]10;?\x07"])).toBe(THEME_FOREGROUND);
    expect(scan(["\x1b]11;?\x07"])).toBe(THEME_BACKGROUND);
    expect(scan(["\x1b]10;?\x1b\\"])).toBe(THEME_FOREGROUND);
    expect(scan(["\x1b]11;?\x1b\\"])).toBe(THEME_BACKGROUND);
    expect(scan(["\x1b[?996n"])).toBe(THEME_BACKGROUND);
    expect(scan([bytes("\x1b]11;?\x07")])).toBe(THEME_BACKGROUND);
  });

  it("recognizes a query cut anywhere by a write boundary", () => {
    for (const query of [
      "\x1b]10;?\x07",
      "\x1b]11;?\x1b\\",
      "\x1b]10;?;?\x07",
      "\x1b[?996n",
    ]) {
      const expected = scan([query]);
      expect(expected).not.toBe(0);
      for (const parts of splits(query)) expect(scan(parts)).toBe(expected);
      for (const parts of splits(query))
        expect(scan(parts.map(bytes))).toBe(expected);
    }
  });

  it("keeps the state of one query while another completes", () => {
    expect(scan(["\x1b]11;?\x07\x1b]1", "0;?\x07"])).toBe(BOTH);
    expect(scan(["\x1b[?99", "6n\x1b]11;?\x07"])).toBe(THEME_BACKGROUND);
    expect(scan(["\x1b]11;", "", "?", "\x07"])).toBe(THEME_BACKGROUND);
  });

  it("reports the colors each OSC parameter asks for", () => {
    // Each `?` asks for the next color, so this one carries the background too.
    expect(scan(["\x1b]10;?;?\x07"])).toBe(BOTH);
    expect(scan(["\x1b]10;?;?\x1b\\"])).toBe(BOTH);
    // The second `?` of an OSC 11 query asks for color 12, which does not exist.
    expect(scan(["\x1b]11;?;?\x07"])).toBe(THEME_BACKGROUND);
    expect(scan(["\x1b]10;?;x\x07"])).toBe(THEME_FOREGROUND);
    expect(scan(["\x1b]10;;?\x07"])).toBe(THEME_BACKGROUND);
    expect(scan(["\x1b]10;?\x07\x1b]10;?\x07"])).toBe(THEME_FOREGROUND);
  });

  it("ignores OSC payloads that do not ask for a color", () => {
    expect(scan(["\x1b]0;title\x07"])).toBe(0);
    expect(scan(["\x1b]2;\x1b]10;?\x07\x07"])).toBe(THEME_FOREGROUND);
    // Setting a color is not a query.
    expect(scan(["\x1b]10;#102030\x07"])).toBe(0);
    expect(scan(["\x1b]11;#fafafa\x07"])).toBe(0);
    expect(scan(["\x1b]11;\x07"])).toBe(0);
    expect(scan(["\x1b]10;x\x07"])).toBe(0);
    expect(scan(["\x1b]110\x07"])).toBe(0);
    expect(scan(["\x1b]10\x07"])).toBe(0);
  });

  it("keeps a bare 0x9c in the payload of an OSC query", () => {
    // Neither core ends an OSC at 0x9c, so the query it follows is not asked.
    expect(scan(["\x1b]10;?\x9c\x07"])).toBe(0);
    expect(scan(["\x1b]10;?\x9c"])).toBe(0);
    expect(scan(["\x1b]11;?\x9c", "\x07"])).toBe(0);
    expect(scan(["\x1b]10;?\x9c\x07\x1b]11;?\x07"])).toBe(THEME_BACKGROUND);
  });

  it("ignores other CSI sequences", () => {
    expect(scan(["\x1b[996n"])).toBe(0);
    expect(scan(["\x1b[?966n"])).toBe(0);
    expect(scan(["\x1b[?996;996n"])).toBe(0);
    expect(scan(["\x1b[?996m"])).toBe(0);
    expect(scan(["\x1b[?996$n"])).toBe(0);
    expect(scan(["\x1b[?0996n"])).toBe(THEME_BACKGROUND);
    expect(scan(["\x1b[?2031h\x1b[?996n"])).toBe(THEME_BACKGROUND);
  });

  it("ignores text that only looks like a query", () => {
    expect(scan(["hello 11;? world"])).toBe(0);
    expect(scan(["10;?"])).toBe(0);
  });

  it("answers an OSC query at the escape that starts its terminator", () => {
    // The cores dispatch at ESC, before the `\` of a split ST arrives.
    expect(scan(["\x1b]11;?\x1b"])).toBe(THEME_BACKGROUND);
    expect(scan(["\x1b]11;?\x1b", "\\"])).toBe(THEME_BACKGROUND);
    // The escape that ends one OSC starts the next sequence.
    expect(scan(["\x1b]10;?\x1b]11;?\x07"])).toBe(BOTH);
    expect(scan(["\x1b]10;?\x1b[?996n"])).toBe(BOTH);
    expect(scan(["\x1b]10", "x\x1b]11;?\x07"])).toBe(THEME_BACKGROUND);
  });
});
