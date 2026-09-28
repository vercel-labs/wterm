import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GhosttyCore } from "../ghostty-core.js";

const wasm = readFileSync(
  new URL("../../wasm/ghostty-vt.wasm", import.meta.url),
);
const MiB = 1024 * 1024;
const cores: GhosttyCore[] = [];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(wasm)),
  );
});

afterEach(() => {
  for (const core of cores.splice(0)) core.dispose();
  vi.unstubAllGlobals();
});

async function create(scrollbackLimit: number) {
  const core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/memory.wasm",
    scrollbackLimit,
  });
  cores.push(core);
  return core;
}

function capacity(core: GhosttyCore): number {
  return (
    core as unknown as { wasm: { exports: { memory: WebAssembly.Memory } } }
  ).wasm.exports.memory.buffer.byteLength;
}

it.each([0, 10000, 8 * MiB])(
  "allocates idle screen pages on demand with a %i-byte history budget",
  async (budget) => {
    const core = await create(budget);
    const loaded = capacity(core);
    core.init(100, 30);
    expect(core.getCell(0, 0).char).toBe(32);
    const primary = capacity(core);
    // Allow buffer/allocator overhead without reserving several unused pages.
    // These measure WASM capacity, not physical resident memory.
    expect(primary - loaded).toBeLessThan(3 * MiB);
    core.writeString("primary\x1b[?1049h");
    expect(core.getCell(0, 0).char).toBe(32);
    const alternate = capacity(core);
    expect(alternate - primary).toBeLessThan(2 * MiB);
    core.writeString("alternate\x1b[?1049l");
    expect(core.getCell(0, 0).char).toBe("p".codePointAt(0));
    expect(core.getScrollbackCount()).toBe(0);

    // Reset destroys the alternate screen; its allocation remains reusable.
    for (let cycle = 0; cycle < 20; cycle++) {
      core.writeString("\x1bc\x1b[?1049h");
      expect(core.getCell(0, 0).char).toBe(32);
      core.writeString("reused\x1b[?1049l");
      expect(core.getCell(0, 0).char).toBe(32);
    }
    expect(capacity(core) - alternate).toBeLessThan(512 * 1024);
  },
);

it("grows the page pool for output and keeps retained text through reflow", async () => {
  const core = await create(8 * MiB);
  core.init(100, 30);
  const idle = capacity(core);
  const lines = 5000;
  core.writeString(
    Array.from({ length: lines }, (_, i) => `row-${i}\r\n`).join(""),
  );
  expect(capacity(core)).toBeGreaterThan(idle);

  for (const [cols, rows] of [
    [100, 30],
    [40, 12],
    [120, 40],
  ]) {
    core.resize(cols, rows);
    const count = core.getScrollbackCount();
    expect(count).toBe(lines - rows + 1);
    expect(core.getScrollbackDiscardedCount()).toBe(0);
    for (const offset of [0, 1, 1000, count - 1]) {
      const text = Array.from(
        { length: core.getScrollbackLineLen(offset) },
        (_, col) =>
          String.fromCodePoint(core.getScrollbackCell(offset, col).char || 32),
      )
        .join("")
        .trimEnd();
      expect(text).toBe(`row-${count - 1 - offset}`);
    }
  }
});
