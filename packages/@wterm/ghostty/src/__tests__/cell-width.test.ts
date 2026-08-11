import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GhosttyCore } from "../ghostty-core.js";

/**
 * Runs against the real committed wasm: the width byte comes from the Zig
 * side, so a mocked core cannot observe it.
 */
const WASM_URL = "https://wterm.test/ghostty-vt.wasm";
const wasmBytes = readFileSync(
  fileURLToPath(new URL("../../wasm/ghostty-vt.wasm", import.meta.url)),
);

const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === WASM_URL) {
      return new Response(wasmBytes, {
        headers: { "content-type": "application/wasm" },
      });
    }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

async function newCore(cols = 20, rows = 4) {
  const core = await GhosttyCore.load({ wasmPath: WASM_URL });
  core.init(cols, rows);
  return core;
}

describe("GhosttyCore cell width", () => {
  it("reports 2 for a wide glyph and 0 for its continuation", async () => {
    const core = await newCore();
    core.writeString("A界B\r\n");

    expect([0, 1, 2, 3].map((col) => core.getCell(0, col).width)).toEqual([
      1, 2, 0, 1,
    ]);
  });

  it("keeps the width on a scrolled-off row", async () => {
    const core = await newCore();
    core.writeString("A界B\r\n");
    for (let i = 0; i < 40; i++) core.writeString(`f${i}\r\n`);

    const offset = core.getScrollbackCount() - 1;
    expect(
      [0, 1, 2, 3].map((col) => core.getScrollbackCell(offset, col).width),
    ).toEqual([1, 2, 0, 1]);
  });

  it("does not collapse a continuation cell into a blank", async () => {
    const core = await newCore();
    core.writeString("界\r\n");

    // The continuation carries no codepoint, flags or colors, so the blank
    // test matches it. Collapsing it would drop the width to 1.
    expect(core.getCell(0, 1).width).toBe(0);
  });
});

describe("GhosttyCore grapheme strings", () => {
  it("returns the complete combining sequence from the active grid", async () => {
    const core = await newCore();
    core.writeString("e\u0301");

    expect(core.getCell(0, 0)).toMatchObject({
      char: "e".codePointAt(0),
      chars: "e\u0301",
      width: 1,
    });
  });

  it("returns the complete ZWJ sequence from the active grid", async () => {
    const core = await newCore();
    core.writeString("👩‍💻");

    expect(core.getCell(0, 0).chars).toBe("👩‍💻");
  });

  it("keeps the complete grapheme after the row enters scrollback", async () => {
    const core = await newCore();
    core.writeString("e\u0301\r\n");
    for (let i = 0; i < 40; i++) core.writeString(`f${i}\r\n`);

    const offset = core.getScrollbackCount() - 1;
    expect(core.getScrollbackCell(offset, 0).chars).toBe("e\u0301");
  });

  it("survives WASM memory growth while reading a grapheme", async () => {
    const core = await newCore();
    core.writeString("e\u0301x");

    const internals = core as unknown as {
      wasm: {
        exports: Record<string, (...args: unknown[]) => number> & {
          memory: WebAssembly.Memory;
        };
      };
    };
    const wasm = internals.wasm;
    const exports: Record<string, unknown> = {};
    for (const key of Object.keys(wasm.exports)) {
      exports[key] = wasm.exports[key];
    }
    const real = wasm.exports.get_viewport_grapheme;
    let grew = false;
    exports.get_viewport_grapheme = (...args: unknown[]) => {
      if (!grew) {
        wasm.exports.memory.grow(1);
        grew = true;
      }
      return real(...args);
    };
    internals.wasm = {
      ...wasm,
      exports: exports as typeof wasm.exports,
    };

    expect(core.getCell(0, 0).chars).toBe("e\u0301");
    internals.wasm = wasm;

    expect(core.getCell(0, 1).char).toBe("x".codePointAt(0));
  });
});

describe("GhosttyCore input modes", () => {
  it("reads mouse and focus state from the committed WASM", async () => {
    const core = await newCore();
    core.writeString("\x1b[?1002h\x1b[?1004h\x1b[?1006h");

    expect(core.mouseTracking()).toBe(1002);
    expect(core.mouseSgr()).toBe(true);
    expect(core.focusEvents()).toBe(true);
  });
});

describe("GhosttyCore spacer heads", () => {
  it("reports the right-margin blank as narrow, not as a continuation", async () => {
    // A wide glyph that does not fit wraps, and ghostty marks the column it
    // left behind as a spacer head. That column is not a continuation.
    const core = await newCore(5, 3);
    core.writeString("abcd界");

    expect([0, 1, 2, 3, 4].map((col) => core.getCell(0, col).width)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect([0, 1].map((col) => core.getCell(1, col).width)).toEqual([2, 0]);
  });
});
