import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TerminalThemeColors } from "@wterm/core";
import { GhosttyCore } from "../ghostty-core.js";

const bytes = readFileSync(
  new URL("../../wasm/ghostty-vt.wasm", import.meta.url),
);
const cores: GhosttyCore[] = [];
const theme = (background = 0xfafafa): TerminalThemeColors => ({
  foreground: 0x383a42,
  background,
  cursor: 0x526fff,
  palette: Array.from({ length: 16 }, (_, index) => 0x102030 + index),
});
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  ),
);
afterEach(() => {
  for (const core of cores.splice(0)) core.dispose();
  vi.unstubAllGlobals();
});
async function create() {
  const core = await GhosttyCore.load();
  cores.push(core);
  core.init(20, 4);
  return core;
}

it("updates indexed viewport and retained colors, preserving application overrides and reset defaults", async () => {
  const core = await create();
  core.writeString("\x1b[31mhistory\r\n\r\n\r\n\r\n\x1b[32mlive");
  core.getCell(3, 0);
  core.getScrollbackCell(0, 0);
  core.setThemeColors(theme());
  expect(core.getCell(3, 0).fgRgb).toBe(0x102032);
  expect(core.getScrollbackCell(0, 0).fgRgb).toBe(0x102031);
  expect(core.getColorOverrides()).toEqual({});
  core.writeString("\x1b]4;2;#abcdef\x07\x1b]10;#112233;#445566;#778899\x07");
  core.setThemeColors(theme(0xffffff));
  expect(core.getCell(3, 0).fgRgb).toBe(0xabcdef);
  expect(core.getColorOverrides()).toEqual({
    foreground: 0x112233,
    background: 0x445566,
    cursor: 0x778899,
  });
  core.writeString(
    "\x1b]104;2\x07\x1b]110\x07\x1b]111\x07\x1b]112\x07\x1b]10;?\x07\x1b]11;?\x07",
  );
  expect(core.getCell(3, 0).fgRgb).toBe(0x102032);
  expect(core.getColorOverrides()).toEqual({});
  expect(core.getResponse()).toBe("\x1b]10;rgb:3838/3a3a/4242\x07");
  expect(core.getResponse()).toBe("\x1b]11;rgb:ffff/ffff/ffff\x07");
});

it("preserves fragmented parser input, cursor, alternate screen, and synchronized-output state", async () => {
  const core = await create();
  core.writeString("primary\x1b[?1049h\x1b[H\x1b[?2026h\x1b[3");
  core.setThemeColors(theme());
  expect(core.usingAltScreen()).toBe(true);
  expect(core.synchronizedOutput()).toBe(true);
  core.writeString("1mX");
  expect(core.getCell(0, 0).char).toBe(88);
  expect(core.getCell(0, 0).fgRgb).toBe(0x102031);
  core.writeRaw(new Uint8Array([0xe8]));
  core.setThemeColors(theme(0xffffff));
  core.writeRaw(new Uint8Array([0xaa, 0x9e]));
  expect(core.getCell(0, 1).char).toBe("語".codePointAt(0));
  const cursor = core.getCursor();
  core.writeString("\x1b]10;#123");
  core.setThemeColors(theme());
  expect(core.getCursor()).toEqual(cursor);
  core.writeString("456\x07\x1b[?2026l\x1b[?1049l");
  expect(core.getColorOverrides().foreground).toBe(0x123456);
  expect(core.getCell(0, 0).char).toBe(112);
  expect(core.getResponse()).toBeNull();
});

it("copies theme values before initialization and retains them through reinitialization", async () => {
  const core = await GhosttyCore.load();
  cores.push(core);
  const colors = theme();
  core.setThemeColors(colors);
  (colors.palette as number[])[1] = 0;
  for (let i = 0; i < 2; i++) {
    core.init(20, 4);
    core.writeString("\x1b[31mX\x1b]11;?\x07");
    expect(core.getCell(0, 0).fgRgb).toBe(0x102031);
    expect(core.getResponse()).toBe("\x1b]11;rgb:fafa/fafa/fafa\x07");
  }
});

it("rejects invalid colors before changing any defaults", async () => {
  const core = await create();
  core.setThemeColors(theme());
  for (const invalid of [
    theme().palette.slice(1),
    [...theme().palette.slice(1), -1],
    [...theme().palette.slice(1), NaN],
  ])
    expect(() =>
      core.setThemeColors({ ...theme(), background: 0, palette: invalid }),
    ).toThrow(RangeError);
  expect(() =>
    core.setThemeColors({ ...theme(), foreground: 0x1000000 }),
  ).toThrow(RangeError);
  core.writeString("\x1b]11;?\x07");
  expect(core.getResponse()).toBe("\x1b]11;rgb:fafa/fafa/fafa\x07");
});
