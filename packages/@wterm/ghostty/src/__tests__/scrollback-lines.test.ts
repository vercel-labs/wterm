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

/** Text of a host row, counted from the oldest reported history row. */
function row(core: GhosttyCore, index: number): string {
  const history = core.getScrollbackCount();
  if (index < history) return text(core, history - 1 - index);
  let line = "";
  for (let col = 0; col < core.getCols(); col++)
    line += String.fromCodePoint(core.getCell(index - history, col).char);
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

  it("finds prompts in host rows once rows are hidden past the limit", async () => {
    const core = await filled({ scrollbackLines: 100 }, 0);
    let output = "";
    for (let i = 0; i < 1000; i++)
      output += i % 10 === 0 ? `\x1b]133;A\x07$ cmd ${i}\r\n` : `out ${i}\r\n`;
    core.writeString(output);
    const last = core.getScrollbackCount() + core.getRows() - 1;
    const prompt = core.findPrompt(last, -1);
    expect(prompt).not.toBeNull();
    expect(row(core, prompt!)).toBe("$ cmd 990");
    const earlier = core.findPrompt(prompt!, -1)!;
    expect(row(core, earlier)).toBe("$ cmd 980");
    // The oldest reported prompt has nothing before it the host can see.
    let oldest = earlier;
    for (
      let next = core.findPrompt(oldest, -1);
      next !== null;
      next = core.findPrompt(oldest, -1)
    )
      oldest = next;
    expect(oldest).toBeGreaterThanOrEqual(0);
    expect(row(core, oldest)).toMatch(/^\$ cmd /);
  });

  it("tracks positions in host rows once rows are hidden past the limit", async () => {
    const core = await filled({ scrollbackLines: 100 }, 2000);
    const tracked = core.trackPosition({ row: 50, col: 0 })!;
    const before = row(core, 50);
    write(core, 30, 2000);
    const position = tracked.resolve();
    expect(position).not.toBeNull();
    expect(row(core, position!.row)).toBe(before);
    write(core, 2000, 2030);
    expect(tracked.resolve()).toBeNull();
  });

  it("places images in host rows once rows are hidden past the limit", async () => {
    const core = await filled({ scrollbackLines: 100 }, 2000);
    const pixel = Buffer.from([255, 0, 0]).toString("base64");
    core.writeString(
      `img \x1b_Ga=T,f=24,s=1,v=1,i=5,c=1,r=1;${pixel}\x1b\\\r\n`,
    );
    write(core, 30, 2000);
    const placement = core.getGraphicsState()?.placements[0];
    expect(placement).toBeDefined();
    expect(row(core, placement!.row)).toMatch(/^img/);
    write(core, 2000, 2030);
    expect(core.getGraphicsState()?.placements ?? []).toHaveLength(0);
  });
});
