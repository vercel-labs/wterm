import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GhosttyCore, type GhosttyOptions } from "../ghostty-core.js";

// See scrollback.test.ts: node's fetch cannot read file:// URLs.
const WASM_URL = "https://wterm.test/ghostty-vt.wasm";
const wasmBytes = readFileSync(
  fileURLToPath(new URL("../../wasm/ghostty-vt.wasm", import.meta.url)),
);
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === WASM_URL)
      return new Response(wasmBytes, {
        headers: { "content-type": "application/wasm" },
      });
    return realFetch(input as RequestInfo);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

async function filled(
  options: Omit<GhosttyOptions, "wasmPath">,
  lines: number,
  cols = 80,
) {
  const core = await GhosttyCore.load({ wasmPath: WASM_URL, ...options });
  core.init(cols, 24);
  write(core, lines);
  return core;
}

function text(core: GhosttyCore, offset: number): string {
  let line = "";
  for (let col = 0; col < core.getScrollbackLineLen(offset); col++)
    line += String.fromCodePoint(core.getScrollbackCell(offset, col).char);
  return line.trimEnd();
}

function write(core: GhosttyCore, lines: number, from = 0): void {
  let text = "";
  for (let i = from; i < from + lines; i++) text += `line ${i}\r\n`;
  core.writeString(text);
}

describe("GhosttyCore scrollbackLines", () => {
  it("keeps 1000 lines by default", async () => {
    const core = await filled({}, 5000);
    expect(core.getScrollbackCount()).toBe(1000);
  });

  it("keeps the requested lines, newest first", async () => {
    const core = await filled({ scrollbackLines: 6000 }, 10000);
    expect(core.getScrollbackCount()).toBe(6000);
    // 10000 lines written, 23 still on screen above the cursor row.
    expect(text(core, 0)).toBe("line 9976");
    expect(text(core, 5999)).toBe("line 3977");
    expect(core.getScrollbackDiscardedCount() + core.getScrollbackCount()).toBe(
      9977,
    );
  });

  it("keeps the requested lines after the terminal gets wider", async () => {
    const core = await filled({ scrollbackLines: 3000 }, 100);
    core.resize(300, 24);
    write(core, 8000, 100);
    expect(core.getScrollbackCount()).toBe(3000);
  });

  it("keeps no history at zero", async () => {
    const core = await filled({ scrollbackLines: 0 }, 500);
    expect(core.getScrollbackCount()).toBe(0);
  });

  it("applies a limit set after loading", async () => {
    const core = await filled({}, 10);
    core.setScrollbackLines(4000);
    write(core, 8000, 10);
    expect(core.getScrollbackCount()).toBe(4000);
  });

  it("keeps the byte budget when only scrollbackLimit is set", async () => {
    const core = await filled({ scrollbackLimit: 10000 }, 5000);
    expect(core.getScrollbackCount()).toBeLessThan(1000);
  });

  it("rejects counts that are not whole non-negative numbers", async () => {
    for (const lines of [-1, 1.5, Number.NaN, 2 ** 32])
      await expect(
        GhosttyCore.load({ wasmPath: WASM_URL, scrollbackLines: lines }),
      ).rejects.toThrow(RangeError);
    const core = await filled({}, 0);
    expect(() => core.setScrollbackLines(-1)).toThrow(RangeError);
  });
});
