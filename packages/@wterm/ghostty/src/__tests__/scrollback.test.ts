import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TerminalCore } from "@wterm/core";
import { WasmBridge } from "@wterm/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GhosttyCore } from "../ghostty-core.js";

/**
 * These run against the real committed ghostty-vt.wasm: get_scrollback_line
 * is Zig, so a mocked core cannot observe it. The built-in core is the
 * reference — both are asserted to read back the same rows.
 *
 * loadGhosttyWasm() fetches its binary, and node's fetch has no file://
 * support, so the wasm is served to it from disk through a fetch stub.
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

const COLS = 80;
const ROWS = 24;
const LINES = 100;
/** LINES written, ROWS still on screen, one held by the cursor. */
const EXPECTED_COUNT = LINES - ROWS + 1;

async function newGhostty() {
  const core = await GhosttyCore.load({ wasmPath: WASM_URL });
  core.init(COLS, ROWS);
  return core;
}

async function newBuiltin() {
  const bridge = await WasmBridge.load();
  bridge.init(COLS, ROWS, 10000);
  return bridge;
}

function fill(core: TerminalCore, lines = LINES): void {
  for (let i = 1; i <= lines; i++) core.writeString(`line-${i}\r\n`);
}

function rowText(core: TerminalCore, offset: number): string {
  const len = core.getScrollbackLineLen(offset);
  let text = "";
  for (let col = 0; col < len; col++) {
    text += String.fromCodePoint(
      core.getScrollbackCell(offset, col).char || 32,
    );
  }
  return text.trimEnd();
}

describe("GhosttyCore scrollback readback", () => {
  it("reads back the rows that scrolled off", async () => {
    const core = await newGhostty();
    fill(core);

    expect(core.getScrollbackCount()).toBe(EXPECTED_COUNT);
    expect(rowText(core, 0)).toBe(`line-${EXPECTED_COUNT}`);
    expect(rowText(core, EXPECTED_COUNT - 1)).toBe("line-1");
  });

  it("matches the built-in core on text and length", async () => {
    const ghostty = await newGhostty();
    const builtin = await newBuiltin();
    fill(ghostty);
    fill(builtin);

    expect(ghostty.getScrollbackCount()).toBe(builtin.getScrollbackCount());

    // Length matters on its own: the renderer uses it as the cell-count
    // bound for the row, so a shorter row would build fewer elements.
    for (const offset of [0, 1, 38, EXPECTED_COUNT - 1]) {
      expect(ghostty.getScrollbackLineLen(offset)).toBe(
        builtin.getScrollbackLineLen(offset),
      );
      expect(rowText(ghostty, offset)).toBe(rowText(builtin, offset));
    }
  });

  it("returns nothing past the last retained row", async () => {
    const core = await newGhostty();
    fill(core);

    expect(core.getScrollbackLineLen(EXPECTED_COUNT)).toBe(0);
    expect(core.getScrollbackCell(EXPECTED_COUNT, 0).char).toBe(32);
  });

  it("carries cell colors through", async () => {
    const core = await newGhostty();
    core.writeString("\x1b[31mred\x1b[0m\r\n");
    fill(core);

    const offset = core.getScrollbackCount() - 1;
    expect(rowText(core, offset)).toBe("red");
    expect(core.getScrollbackCell(offset, 0).fgRgb).toBeDefined();
    expect(core.getScrollbackCell(offset, 4).fgRgb).toBeUndefined();
  });

  it("decodes each row once however many columns are read", async () => {
    const core = await newGhostty();
    fill(core);

    // The wasm exports are read-only and non-configurable, so counting needs
    // a plain copy swapped in rather than a patch or a proxy.
    const internals = core as unknown as {
      wasm: { exports: Record<string, (...args: unknown[]) => number> };
    };
    const wasm = internals.wasm;
    const exports: Record<string, unknown> = {};
    for (const key of Object.keys(wasm.exports)) {
      exports[key] = wasm.exports[key];
    }
    const real = wasm.exports.get_scrollback_line;
    let calls = 0;
    exports.get_scrollback_line = (...args: unknown[]) => {
      calls++;
      return real(...args);
    };
    internals.wasm = { ...wasm, exports };

    // The access pattern Renderer._buildScrollbackRowEl uses.
    const len = core.getScrollbackLineLen(0);
    for (let col = 0; col < len; col++) core.getScrollbackCell(0, col);

    internals.wasm = wasm;

    expect(len).toBe(COLS);
    expect(calls).toBe(1);
  });

  it("survives a WASM memory grow between reads of the same row", async () => {
    const core = await newGhostty();
    fill(core);

    const memory = (
      core as unknown as { wasm: { exports: { memory: WebAssembly.Memory } } }
    ).wasm.exports.memory;

    // A cache hit reuses the decoded row, so nothing re-reads the WASM side
    // and a grow in between would leave the DataView detached.
    expect(core.getScrollbackLineLen(0)).toBe(COLS);
    memory.grow(64);

    expect(rowText(core, 0)).toBe(`line-${EXPECTED_COUNT}`);
  });

  it("re-reads a row after new output", async () => {
    const core = await newGhostty();
    fill(core);
    const before = rowText(core, 0);

    // Pushes one more row off the top; the new text stays in the viewport.
    core.writeString("after\r\n");

    expect(rowText(core, 0)).toBe(`line-${EXPECTED_COUNT + 1}`);
    expect(rowText(core, 0)).not.toBe(before);
    expect(rowText(core, 1)).toBe(before);
  });

  it("counts rows discarded from the oldest end", async () => {
    const core = await GhosttyCore.load({
      wasmPath: WASM_URL,
      scrollbackLimit: 4096,
    });
    core.init(COLS, ROWS);
    fill(core, 5000);

    expect(core.getScrollbackCount()).toBeGreaterThan(0);
    expect(core.getScrollbackDiscardedCount()).toBeGreaterThan(0);
  });
});

describe("GhosttyCore scrollback isolation", () => {
  it("hides primary scrollback while the alt screen is active", async () => {
    const core = await newGhostty();
    fill(core);

    core.writeString("\x1b[?1049h");
    expect(core.getScrollbackCount()).toBe(0);
    expect(core.getScrollbackLineLen(0)).toBe(0);

    core.writeString("\x1b[?1049l");
    expect(core.getScrollbackCount()).toBe(EXPECTED_COUNT);
    expect(rowText(core, 0)).toBe(`line-${EXPECTED_COUNT}`);
  });

  it("returns nothing for an out-of-range u32 offset", async () => {
    const core = await newGhostty();
    fill(core);

    // Offset is widened before the + 1 that walks past the active area, so
    // the maximum u32 cannot wrap around to the newest row.
    expect(core.getScrollbackLineLen(0xffffffff)).toBe(0);
    expect(core.getScrollbackCell(0xffffffff, 0).char).toBe(32);
  });

  it("reads a wrapped logical line back after it reflows", async () => {
    const core = await newGhostty();
    // Longer than COLS, so shrinking has to rewrap it rather than move it.
    // Parity with the built-in core is not asserted here: it keeps the old
    // row width on resize instead of reflowing.
    const long = "W".repeat(100) + "END";
    core.writeString(`${long}\r\n`);
    fill(core, 40);
    core.resize(40, 12);

    // The logical line now occupies the three oldest rows at the new width.
    const last = core.getScrollbackCount() - 1;
    const rows = [last, last - 1, last - 2].map((offset) => ({
      len: core.getScrollbackLineLen(offset),
      text: rowText(core, offset),
    }));

    expect(rows.map((r) => r.len)).toEqual([40, 40, 40]);
    expect(rows.map((r) => r.text).join("")).toBe(long);
  });

  it("keeps scrollback readable across a resize", async () => {
    const core = await newGhostty();
    fill(core);

    core.resize(40, 12);
    expect(core.getScrollbackCount()).toBeGreaterThan(0);
    expect(core.getScrollbackLineLen(0)).toBe(40);

    core.resize(COLS, ROWS);
    expect(core.getScrollbackCount()).toBe(EXPECTED_COUNT);
    expect(rowText(core, 0)).toBe(`line-${EXPECTED_COUNT}`);
  });
});
