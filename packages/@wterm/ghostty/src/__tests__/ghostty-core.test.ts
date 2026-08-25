import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getScrollbackCell() reads a single scrollback cell out of a WASM-owned
 * buffer written by get_scrollback_line(). We fake that buffer here so we
 * can exercise GhosttyCore's parsing logic without needing a real
 * ghostty-vt.wasm build (which loadGhosttyWasm() fetches over the network).
 */
const state = vi.hoisted(() => {
  return {
    memory: new WebAssembly.Memory({ initial: 1 }),
    line: null as Uint8Array | null,
    lineLen: 0,
  };
});

vi.mock("../wasm-bindings.js", async () => {
  const actual = await vi.importActual<typeof import("../wasm-bindings.js")>(
    "../wasm-bindings.js",
  );

  const exports = {
    memory: state.memory,
    init: () => 1,
    resize: () => {},
    // 0 is treated as an allocation failure by ghostty-core.ts, so the
    // fake pointer must be nonzero.
    alloc_buffer: () => 64,
    free_buffer: () => {},
    get_scrollback_line: (
      _ptr: number,
      _offset: number,
      bufPtr: number,
      _maxCols: number,
    ) => {
      if (!state.line) return 0;
      new Uint8Array(state.memory.buffer, bufPtr, state.line.length).set(
        state.line,
      );
      return state.lineLen;
    },
    mouse_tracking: () => 1002,
    mouse_sgr: () => 1,
    focus_events: () => 1,
  };

  return {
    ...actual,
    loadGhosttyWasm: vi.fn(async () => ({
      exports,
      instance: {} as WebAssembly.Instance,
    })),
  };
});

const { GhosttyCore } = await import("../ghostty-core.js");
const { CELL_BYTES } = await import("../wasm-bindings.js");

/** Build one raw scrollback cell matching the 16-byte wasm_api.zig layout. */
function buildCellBytes(opts: {
  codepoint: number;
  fgR?: number;
  fgG?: number;
  fgB?: number;
  bgR?: number;
  bgG?: number;
  bgB?: number;
  flags?: number;
  colorFlags: number;
}): Uint8Array {
  const buf = new ArrayBuffer(CELL_BYTES);
  const view = new DataView(buf);
  view.setUint32(0, opts.codepoint, true);
  view.setUint8(4, opts.fgR ?? 0);
  view.setUint8(5, opts.fgG ?? 0);
  view.setUint8(6, opts.fgB ?? 0);
  view.setUint8(7, opts.bgR ?? 0);
  view.setUint8(8, opts.bgG ?? 0);
  view.setUint8(9, opts.bgB ?? 0);
  view.setUint8(10, opts.flags ?? 0);
  view.setUint8(11, 1); // width
  view.setUint8(12, opts.colorFlags);
  return new Uint8Array(buf);
}

describe("GhosttyCore.getScrollbackCell", () => {
  beforeEach(() => {
    state.line = null;
    state.lineLen = 0;
  });

  it("does not set fgRgb/bgRgb when colorFlags === 0 (falls back to defaults)", async () => {
    state.line = buildCellBytes({ codepoint: 65, colorFlags: 0 });
    state.lineLen = 1;

    const core = await GhosttyCore.load();
    core.init(80, 24);
    const cell = core.getScrollbackCell(0, 0);

    expect(cell.char).toBe(65);
    expect(cell.fgRgb).toBeUndefined();
    expect(cell.bgRgb).toBeUndefined();
  });

  it("sets fgRgb/bgRgb from the explicit color bytes when colorFlags is set", async () => {
    state.line = buildCellBytes({
      codepoint: 66,
      fgR: 10,
      fgG: 20,
      fgB: 30,
      bgR: 40,
      bgG: 50,
      bgB: 60,
      colorFlags: 0b11,
    });
    state.lineLen = 1;

    const core = await GhosttyCore.load();
    core.init(80, 24);
    const cell = core.getScrollbackCell(0, 0);

    expect(cell.char).toBe(66);
    expect(cell.fgRgb).toBe((10 << 16) | (20 << 8) | 30);
    expect(cell.bgRgb).toBe((40 << 16) | (50 << 8) | 60);
  });
});

describe("GhosttyCore input modes", () => {
  it("exposes mouse and focus state", async () => {
    const core = await GhosttyCore.load();
    core.init(80, 24);

    expect(core.mouseTracking()).toBe(1002);
    expect(core.mouseSgr()).toBe(true);
    expect(core.focusEvents()).toBe(true);
  });
});
