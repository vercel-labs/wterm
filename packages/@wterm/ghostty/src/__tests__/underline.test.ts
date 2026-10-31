import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GhosttyCore } from "../ghostty-core.js";
import {
  loadGhosttyWasm,
  writeString,
  CELL_BYTES,
  CELL_BYTES_V2,
} from "../wasm-bindings.js";

const bytes = readFileSync(
  new URL("../../wasm/ghostty-vt.wasm", import.meta.url),
);
const cores: GhosttyCore[] = [];
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
});
afterEach(() => {
  for (const core of cores.splice(0)) core.dispose();
  vi.unstubAllGlobals();
});
async function createCore(cols = 20, rows = 3) {
  const core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/ghostty.wasm",
  });
  core.init(cols, rows);
  cores.push(core);
  return core;
}

describe("Ghostty underline readback", () => {
  it.each(["single", "double", "curly", "dotted", "dashed"] as const)(
    "preserves %s underlines and true color across fragmented writes",
    async (style) => {
      const core = await createCore();
      const code =
        ["single", "double", "curly", "dotted", "dashed"].indexOf(style) + 1;
      for (const byte of new TextEncoder().encode(
        `\x1b[4:${code};58:2::18:52:86mA界e\u0301`,
      ))
        core.writeRaw(new Uint8Array([byte]));
      for (const col of [0, 1, 3]) {
        expect(core.getCell(0, col)).toMatchObject({
          underlineStyle: style,
          underlineRgb: 0x123456,
        });
        expect(core.getCell(0, col).flags & 8).toBe(8);
      }
      expect(core.getCell(0, 1).width).toBe(2);
      expect(core.getCell(0, 3).chars).toBe("e\u0301");
    },
  );

  it("resolves indexed underline colors and respects 59, 24, 4:0, and SGR reset", async () => {
    const core = await createCore();
    core.writeString(
      "\x1b]4;42;rgb:12/34/56\x1b\\\x1b[4;58;5;42mA\x1b[59mB\x1b[58;2;0;0;0mC\x1b[24mD\x1b[21mE\x1b[4:0mF\x1b[0mG",
    );
    expect(core.getCell(0, 0)).toMatchObject({
      underlineStyle: "single",
      underlineRgb: 0x123456,
    });
    expect(core.getCell(0, 1).underlineRgb).toBeUndefined();
    expect(core.getCell(0, 2).underlineRgb).toBe(0);
    expect(core.getCell(0, 3).underlineStyle).toBe("none");
    expect(core.getCell(0, 4).underlineStyle).toBe("double");
    expect(core.getCell(0, 5).underlineStyle).toBe("none");
    expect(core.getCell(0, 6).underlineRgb).toBeUndefined();
    core.writeString("\x1b]4;42;rgb:ab/cd/ef\x1b\\");
    expect(core.getCell(0, 0).underlineRgb).toBe(0xabcdef);
  });

  it("keeps underlines in history and across reflow", async () => {
    const core = await createCore(8, 2);
    core.writeString("\x1b[4:3;58;2;18;52;86mABCDEFGH界\x1b[0m\r\nlast\r\n");
    expect(core.getScrollbackCount()).toBeGreaterThan(0);
    expect(
      core.getScrollbackCell(core.getScrollbackCount() - 1, 0),
    ).toMatchObject({
      char: 65,
      underlineStyle: "curly",
      underlineRgb: 0x123456,
    });
    core.resize(5, 2);
    const styled = [];
    for (let offset = core.getScrollbackCount() - 1; offset >= 0; offset--) {
      for (let col = 0; col < core.getScrollbackLineLen(offset); col++)
        styled.push(core.getScrollbackCell(offset, col));
    }
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 5; col++) styled.push(core.getCell(row, col));
    const letters = styled.filter((cell) => cell.char >= 65 && cell.char <= 72);
    expect(letters).toHaveLength(8);
    for (const cell of letters)
      expect(cell).toMatchObject({
        underlineStyle: "curly",
        underlineRgb: 0x123456,
      });
  });

  it("redraws underline-only changes without leaking styles after clear or screen switches", async () => {
    const core = await createCore();
    core.writeString("\x1b[4:3;58;2;18;52;86mA\x1b[0m");
    expect(core.getCell(0, 0).underlineStyle).toBe("curly");
    core.clearDirty();
    core.writeString("\r\x1b[4:5;58;2;0;0;0mA\x1b[0m");
    expect(core.isDirtyRow(0)).toBe(true);
    expect(core.getCell(0, 0)).toMatchObject({
      underlineStyle: "dashed",
      underlineRgb: 0,
    });
    core.writeString("\x1b[?1049h\x1b[H\x1b[4:2;58;2;255;0;0mB\x1b[0m");
    expect(core.getCell(0, 0).underlineStyle).toBe("double");
    core.writeString("\x1b[?1049l");
    expect(core.getCell(0, 0).underlineStyle).toBe("dashed");
    core.writeString("\x1b[2J\x1b[HA");
    expect(core.getCell(0, 0).underlineStyle).toBe("none");
    expect(core.getCell(0, 0).underlineRgb).toBeUndefined();
  });

  it("retains the 16-byte viewport and history ABI alongside the new exports", async () => {
    const wasm = await loadGhosttyWasm("https://wterm.test/ghostty.wasm");
    const ex = wasm.exports;
    const ptr = ex.init(4, 2, 100, 0xffffff, 0, 0);
    const legacy = ex.alloc_buffer(8 * CELL_BYTES + 8);
    const modern = ex.alloc_buffer(8 * CELL_BYTES_V2);
    try {
      writeString(wasm, ptr, "\x1b[4:3;58;2;18;52;86;31;44mAB界\r\nCD\r\nEF");
      ex.update(ptr);
      for (const history of [false, true]) {
        new Uint8Array(ex.memory.buffer, legacy, 8 * CELL_BYTES + 8).fill(0xa5);
        const count = history
          ? ex.get_scrollback_line(ptr, 0, legacy, 4)
          : ex.get_viewport(ptr, legacy);
        expect(count).toBe(history ? 4 : 8);
        const countV2 = history
          ? ex.get_scrollback_line_v2!(ptr, 0, modern, 4)
          : ex.get_viewport_v2!(ptr, modern);
        expect(countV2).toBe(count);
        const old = new Uint8Array(
          ex.memory.buffer,
          legacy,
          count * CELL_BYTES + 8,
        );
        const next = new Uint8Array(
          ex.memory.buffer,
          modern,
          count * CELL_BYTES_V2,
        );
        expect([...old.slice(count * CELL_BYTES)]).toEqual(Array(8).fill(0xa5));
        for (let i = 0; i < count; i++) {
          const base = next.slice(
            i * CELL_BYTES_V2,
            i * CELL_BYTES_V2 + CELL_BYTES,
          );
          base[12] &= 3;
          expect([...old.slice(i * CELL_BYTES, (i + 1) * CELL_BYTES)]).toEqual([
            ...base,
          ]);
        }
      }
    } finally {
      ex.free_buffer(legacy, 8 * CELL_BYTES + 8);
      ex.free_buffer(modern, 8 * CELL_BYTES_V2);
      ex.deinit(ptr);
    }
  });
});
