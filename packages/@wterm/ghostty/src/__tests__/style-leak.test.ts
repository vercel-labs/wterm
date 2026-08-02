import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GhosttyCore } from "../ghostty-core.js";

/**
 * Unlike the other suite in this package, these tests run against the real
 * committed ghostty-vt.wasm. The defect they guard lives in the Zig side
 * (get_viewport reading RenderState.Cell.style without checking style_id), so
 * a mocked core would not be able to observe it.
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

const COLS = 40;
const ROWS = 8;

async function newCore() {
  const core = await GhosttyCore.load({ wasmPath: WASM_URL });
  core.init(COLS, ROWS);
  return core;
}

/**
 * Reading the grid is also what triggers a render pass, which is what
 * refreshes the shared style array. Counting styled cells therefore has to
 * happen through the same path a renderer uses.
 */
function styledCellCount(core: GhosttyCore): number {
  let styled = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = core.getCell(row, col);
      if (
        cell.flags !== 0 ||
        cell.fgRgb !== undefined ||
        cell.bgRgb !== undefined
      ) {
        styled++;
      }
    }
  }
  return styled;
}

describe("style_id gating in get_viewport", () => {
  it("does not carry alt-screen SGR back to the primary screen", async () => {
    const core = await newCore();

    core.writeString("\x1b[31mRED\x1b[0m\r\nplain shell output\r\n");
    styledCellCount(core); // render pass on the primary screen

    core.writeString("\x1b[?1049h");
    core.writeString(`\x1b[1;33m${"BOLD-YELLOW ".repeat(12)}\x1b[0m`);
    styledCellCount(core); // render pass on the alt screen

    core.writeString("\x1b[?1049l");

    // Only the three cells of RED were ever styled on this screen.
    expect(styledCellCount(core)).toBe(3);
  });

  it("does not carry alt-screen reverse video back to the primary screen", async () => {
    const core = await newCore();

    core.writeString("$ vi notes.txt\r\nsome plain text here\r\n");
    styledCellCount(core);

    core.writeString("\x1b[?1049h");
    core.writeString(`\x1b[7m${"SELECTED".repeat(4)}\x1b[27m\r\n`);
    styledCellCount(core);

    core.writeString("\x1b[?1049l");

    expect(styledCellCount(core)).toBe(0);
  });

  it("does not leave SGR residue behind after a clear", async () => {
    const core = await newCore();

    let dense = "";
    for (let i = 0; i < 120; i++) dense += `\x1b[38;5;${i % 256}m#`;
    for (let i = 0; i < 120; i++) {
      dense += `\x1b[38;2;${(i * 2) % 256};${(i * 5) % 256};${(i * 7) % 256}m*`;
    }
    core.writeString(`${dense}\x1b[0m`);
    styledCellCount(core);

    core.writeString("\x1b[2J\x1b[H");
    core.writeString("after clear: this line should be unstyled\r\n");

    expect(styledCellCount(core)).toBe(0);
  });
});
