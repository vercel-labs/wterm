import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhosttyCore } from "../ghostty-core.js";

const bytes = readFileSync(
  new URL("../../wasm/ghostty-vt.wasm", import.meta.url),
);
const cores: GhosttyCore[] = [];
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
async function createCore() {
  const core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/ghostty.wasm",
  });
  cores.push(core);
  return core;
}

describe("Ghostty application default colors", () => {
  it("distinguishes unset colors, black, and explicit values equal to configured defaults", async () => {
    const core = await createCore();
    expect(core.getColorOverrides()).toEqual({});
    core.init(20, 4);
    expect(core.getColorOverrides()).toEqual({});
    core.writeString(
      "\x1b]10;#d4d4d4\x07\x1b]11;#000000\x07\x1b]12;#123456\x07",
    );
    expect(core.getColorOverrides()).toEqual({
      foreground: 0xd4d4d4,
      background: 0,
      cursor: 0x123456,
    });
    const copy = core.getColorOverrides();
    copy.foreground = 0;
    expect(core.getColorOverrides().foreground).toBe(0xd4d4d4);
    core.dispose();
    expect(core.getColorOverrides()).toEqual({});
  });

  it("decodes fragmented OSC with both terminators and ignores invalid colors", async () => {
    const core = await createCore();
    core.init(20, 4);
    for (const byte of new TextEncoder().encode(
      "\x1b]10;rgb:12/34/56;rgb:ab/cd/ef;#000000\x1b\\",
    ))
      core.writeRaw(new Uint8Array([byte]));
    expect(core.getColorOverrides()).toEqual({
      foreground: 0x123456,
      background: 0xabcdef,
      cursor: 0,
    });
    core.writeString("\x1b]10;not-a-color\x07\x1b]11;?\x07");
    expect(core.getColorOverrides()).toEqual({
      foreground: 0x123456,
      background: 0xabcdef,
      cursor: 0,
    });
    expect(core.getResponse()).toBe("\x1b]11;rgb:abab/cdcd/efef\x07");
  });

  it.each([
    [110, "foreground"],
    [111, "background"],
    [112, "cursor"],
  ] as const)(
    "OSC %s resets only %s and preserves configured query responses",
    async (code, key) => {
      const core = await createCore();
      core.init(20, 4);
      core.writeString("\x1b]10;#112233;#445566;#778899\x07");
      const expected = core.getColorOverrides();
      delete expected[key];
      core.writeString(`\x1b]${code}\x1b\\`);
      expect(core.getColorOverrides()).toEqual(expected);
      core.writeString("\x1b]110\x07\x1b]111\x07\x1b]10;?\x07\x1b]11;?\x07");
      expect(core.getResponse()).toBe("\x1b]10;rgb:d4d4/d4d4/d4d4\x07");
      expect(core.getResponse()).toBe("\x1b]11;rgb:1e1e/1e1e/1e1e\x07");
    },
  );

  it("follows native color lifetime through resize, screen switches, SGR/RIS, and reinitialization", async () => {
    const core = await createCore();
    core.init(20, 4);
    core.writeString("\x1b]10;#112233;#445566;#778899\x07");
    const expected = core.getColorOverrides();
    core.resize(30, 5);
    for (const sequence of ["\x1b[?1049h", "\x1b[?1049l", "\x1b[0m", "\x1bc"]) {
      core.writeString(sequence);
      expect(core.getColorOverrides()).toEqual(expected);
    }
    core.init(20, 4);
    expect(core.getColorOverrides()).toEqual({});
  });
});
