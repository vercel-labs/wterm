import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalCore } from "@wterm/core";
import { GhosttyCore } from "../../../ghostty/src/ghostty-core.js";
import { WTerm } from "../wterm.js";
import { selectionRange } from "../selection-range.js";

const wasm = readFileSync(
  resolve(process.cwd(), "../ghostty/wasm/ghostty-vt.wasm"),
);
let core: GhosttyCore;
let term: WTerm;
let element: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(wasm)),
  );
  core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/selection.wasm",
    scrollbackLimit: 1024 * 1024,
  });
  element = document.createElement("div");
  document.body.appendChild(element);
  vi.useFakeTimers();
  term = new WTerm(element, { core, cols: 12, rows: 4, autoResize: false });
  await term.init();
});
afterEach(() => {
  term.destroy();
  core.dispose();
  element.remove();
  document.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function write(text: string) {
  term.write(text);
  await vi.runAllTimersAsync();
}

describe("word and logical-line selection", () => {
  it("selects paths and hyphenated words across soft wraps with native highlights", async () => {
    await write("run ./src/long-file.ts done");
    expect(term.selectWord({ row: 1, col: 2 })).toBe(true);
    expect(term.getSelectionText()).toBe("./src/long-file.ts");
    expect(document.getSelection()?.isCollapsed).toBe(false);
    for (const cols of [8, 24, 12]) {
      term.resize(cols, 4);
      await vi.runAllTimersAsync();
      expect(term.getSelectionText()).toBe("./src/long-file.ts");
    }
  });

  it("treats punctuation as a separate run, without swallowing adjacent wide cells", async () => {
    await write("界 (x), y");
    expect(term.selectWord({ row: 0, col: 2 })).toBe(true);
    expect(term.getSelectionText()).toBe(" (");
    expect(term.selectWord({ row: 0, col: 4 })).toBe(true);
    expect(term.getSelectionText()).toBe("x");
    expect(term.selectWord({ row: 0, col: 5 })).toBe(true);
    expect(term.getSelectionText()).toBe("), ");
  });

  it("selects whole graphemes from either half of wide cells and omits spacer heads", async () => {
    term.resize(6, 4);
    await vi.runAllTimersAsync();
    await write("abcde界e\u0301😀xyz");
    for (const col of [0, 1, 2, 3, 4]) {
      expect(term.selectWord({ row: 1, col })).toBe(true);
      expect(term.getSelectionText()).toBe("abcde界e\u0301😀xyz");
    }
    expect(term.selectWord({ row: 0, col: 5 })).toBe(false);
    expect(term.getSelectionText()).toBe("abcde界e\u0301😀xyz");
  });

  it("never crosses hard or unknown row boundaries", async () => {
    term.resize(6, 4);
    await vi.runAllTimersAsync();
    await write("abcdef\r\nghijkl");
    expect(term.selectWord({ row: 1, col: 0 })).toBe(true);
    expect(term.getSelectionText()).toBe("ghijkl");
    await write("\x1bcabcdefghij");
    core.getRowMetadata = () => null;
    term.write("");
    await vi.runAllTimersAsync();
    expect(term.selectLine(1)).toBe(true);
    expect(term.getSelectionText()).toBe("ghij");
  });

  it("selects a complete logical line including indentation without the next hard line", async () => {
    await write("  long command with arguments\r\nnext");
    expect(term.selectLine(1)).toBe(true);
    expect(term.getSelectionText()).toBe("  long command with arguments");
    expect(term.selectLine(3)).toBe(true);
    expect(term.getSelectionText()).toBe("next");
  });

  it("mounts an unmounted wrapped line separately from the viewport and tracks it during output", async () => {
    Object.defineProperty(element, "clientHeight", { value: 68 });
    Object.defineProperty(element, "scrollHeight", {
      get: () => (core.getScrollbackCount() + core.getRows()) * 17,
    });
    const line = "long-file-name/".repeat(60);
    await write(line + "\r\n" + "other\r\n".repeat(200));
    const before = element.querySelectorAll(".term-row").length;
    expect(before).toBeLessThan(50);
    expect(term.selectLine(20)).toBe(true);
    expect(term.getSelectionText()).toBe(line);
    expect(element.querySelectorAll(".term-row").length).toBeLessThan(120);
    await write("more\r\n".repeat(100));
    expect(term.getSelectionText()).toBe(line);
    expect(element.querySelectorAll(".term-row").length).toBeLessThan(120);
  });

  it("does not select unseen output while painting is pending or synchronized", async () => {
    await write("old");
    expect(term.selectWord({ row: 0, col: 1 })).toBe(true);
    term.write("\x1b[Hnew");
    expect(term.selectWord({ row: 0, col: 1 })).toBe(false);
    expect(term.getSelectionText()).toBe("old");
    await vi.runAllTimersAsync();
    expect(term.selectWord({ row: 0, col: 1 })).toBe(true);
    expect(term.getSelectionText()).toBe("new");
    term.write("\x1b[?2026h\x1b[Hhidden");
    expect(term.selectLine(0)).toBe(false);
    expect(term.getSelectionText()).toBe("new");
  });

  it("leaves prior selections intact for invalid coordinates and oversized lines", async () => {
    await write("chosen");
    expect(term.selectLine(0)).toBe(true);
    for (const row of [-1, NaN, Infinity, 0.5, 99999]) {
      expect(term.selectLine(row)).toBe(false);
      expect(term.getSelectionText()).toBe("chosen");
    }
    for (const col of [-1, NaN, 0.5, 12]) {
      expect(term.selectWord({ row: 0, col })).toBe(false);
    }
    const large = {
      getCols: () => 2,
      getRows: () => 1001,
      getScrollbackCount: () => 0,
      getCell: () => ({ char: 120, width: 1 }),
      getRowMetadata: (row: number) => ({
        wrapsToNext: row < 1000,
        continuesPrevious: row > 0,
      }),
    } as unknown as TerminalCore;
    expect(selectionRange(large, { row: 0, col: 0 }, "word")).toBeNull();
    expect(selectionRange(large, { row: 500, col: 1 }, "line")).toBeNull();
    large.getCell = () => ({
      char: 120,
      chars: "x".repeat(1024 * 1024 + 1),
      fg: 256,
      bg: 256,
      flags: 0,
    });
    expect(selectionRange(large, { row: 0, col: 0 }, "word")).toBeNull();
  });

  it("replaces Select All and supports cores without position tracking", async () => {
    await write("one two");
    const all = term.selectAll();
    await vi.runAllTimersAsync();
    expect(await all).toBe(true);
    core.trackPosition = undefined as never;
    expect(term.selectWord({ row: 0, col: 4 })).toBe(true);
    expect(term.getSelectionText()).toBe("two");
    expect(element.classList.contains("term-select-all")).toBe(false);
  });

  it("stops if a focus report changes the terminal while selecting", async () => {
    await write("word\x1b[?1004h");
    term.focus();
    term.onData = () => term.write("\x1b[Hchanged");
    expect(term.selectLine(0)).toBe(false);
    await vi.runAllTimersAsync();
    expect(term.getSelectionText()).toBeNull();
    term.destroy();
    expect(term.selectLine(0)).toBe(false);
  });
});
