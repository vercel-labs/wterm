import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalCore } from "@wterm/core";
import { GhosttyCore } from "../../../ghostty/src/ghostty-core.js";
import { HistorySelection, scanSelection } from "../history-selection.js";
import { WTerm } from "../wterm.js";

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
  });
  element = document.createElement("div");
  document.body.appendChild(element);
  vi.useFakeTimers();
  term = new WTerm(element, { core, cols: 6, rows: 4, autoResize: false });
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
async function selectAll() {
  const selected = term.selectAll();
  await vi.runAllTimersAsync();
  expect(await selected).toBe(true);
  return term.getSelectionText();
}
function scan(core: TerminalCore, limit?: number) {
  const generator = scanSelection(core, limit);
  let result = generator.next();
  while (!result.done) result = generator.next();
  return result.value;
}

describe("full-history selection", () => {
  it("reads the entire retained buffer with wraps, blank lines and Unicode intact", async () => {
    await write("abcde界e\u0301😀xyz\r\n\r\nlast");
    expect(core.getScrollbackCount()).toBeGreaterThan(0);
    expect(await selectAll()).toBe("abcde界e\u0301😀xyz\n\nlast");
    expect(element.classList.contains("term-select-all")).toBe(true);
    expect(document.getSelection()?.isCollapsed).toBe(true);
  });

  it("preserves hard row boundaries for cores without wrap metadata", async () => {
    await write("abcdefghij");
    core.getRowMetadata = () => null;
    expect(await selectAll()).toBe("abcdef\nghij\n\n");
  });

  it("copies spaces at soft wraps and omits padding only at hard row ends", async () => {
    await write("abc   def\r\nline  ");
    expect(await selectAll()).toBe("abc   def\nline\n");
  });

  it("yields on empty history and rejects oversized text without returning a prefix", () => {
    const blank = {
      ...core,
      getScrollbackCount: () => 1000,
      getRows: () => 0,
      getScrollbackLineLen: () => 0,
    } as unknown as TerminalCore;
    const generator = scanSelection(blank);
    expect(generator.next()).toEqual({ value: undefined, done: false });
    expect(() => scan(blank, 100)).toThrow(RangeError);
    core.writeString("abcde界");
    expect(() => scan(core, 5)).toThrow(RangeError);
  });

  it("does not expose partial text and prevents partial clipboard fallback", async () => {
    term.write("row\r\n".repeat(100));
    const selected = term.selectAll();
    expect(term.getSelectionText()).toBeNull();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    const clipboardData = { setData: vi.fn() };
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(clipboardData.setData).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(await selected).toBe(true);
    expect(term.getSelectionText()).toBe("row\n".repeat(100));
  });

  it("cancels between scan slices without reading more history", async () => {
    const read = vi.fn(() => 0);
    const large = {
      getScrollbackCount: () => 100000,
      getRows: () => 0,
      getScrollbackLineLen: read,
    } as unknown as TerminalCore;
    const selection = new HistorySelection(element);
    const result = selection.select();
    selection.resume(large);
    await vi.advanceTimersToNextTimerAsync();
    expect(read.mock.calls.length).toBeGreaterThan(0);
    expect(read.mock.calls.length).toBeLessThan(100000);
    expect(selection.getText()).toBeNull();
    selection.invalidate();
    const count = read.mock.calls.length;
    await vi.runAllTimersAsync();
    expect(await result).toBe(false);
    expect(read.mock.calls.length).toBe(count);
    selection.destroy();
  });

  it.each(["write", "resize", "clear", "destroy"])(
    "cancels pending selection on %s",
    async (action) => {
      const selected = term.selectAll();
      if (action === "write") term.write("changed");
      if (action === "resize") term.resize(10, 4);
      if (action === "clear") term.clearSelection();
      if (action === "destroy") term.destroy();
      await vi.runAllTimersAsync();
      expect(await selected).toBe(false);
      expect(term.getSelectionText()).toBeNull();
      expect(element.classList.contains("term-select-all")).toBe(false);
    },
  );

  it.each(["write", "resize"])(
    "clears completed selection on %s",
    async (action) => {
      await write("chosen");
      await selectAll();
      if (action === "write") term.write("changed");
      else term.resize(10, 4);
      expect(term.getSelectionText()).toBeNull();
      await vi.runAllTimersAsync();
      expect(element.classList.contains("term-select-all")).toBe(false);
    },
  );

  it("waits for painting and never captures unseen synchronized output", async () => {
    await write("old");
    term.write("\x1b[?2026h\x1b[Hnew");
    const selected = term.selectAll();
    await vi.advanceTimersByTimeAsync(100);
    expect(term.getSelectionText()).toBeNull();
    term.write("\x1b[?2026l");
    expect(await selected).toBe(false);
    await vi.runAllTimersAsync();
    expect(await selectAll()).toBe("new\n\n\n");
  });

  it("keeps only one terminal's full-history selection active", async () => {
    await write("one");
    await selectAll();
    const otherElement = document.createElement("div");
    document.body.appendChild(otherElement);
    const other = new HistorySelection(otherElement);
    const selected = other.select();
    expect(term.getSelectionText()).toBeNull();
    other.destroy();
    expect(await selected).toBe(false);
    otherElement.remove();
  });

  it("defers to external native selections and leaves them intact on clear", async () => {
    await write("chosen");
    await selectAll();
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    document
      .getSelection()!
      .setBaseAndExtent(outside.firstChild!, 0, outside.firstChild!, 7);
    expect(term.getSelectionText()).toBeNull();
    term.clearSelection();
    expect(document.getSelection()!.toString()).toBe("outside");
    outside.remove();
  });

  it("resolves replaced requests and reports a failed capture", async () => {
    const first = term.selectAll();
    const second = term.selectAll();
    expect(await first).toBe(false);
    vi.spyOn(core, "getCell").mockImplementation(() => {
      throw new Error("Unavailable");
    });
    // Start the scan directly to isolate extraction failure from renderer failure.
    term.clearSelection();
    expect(await second).toBe(false);
    const selection = new HistorySelection(element);
    const failed = selection.select();
    selection.resume(core);
    await vi.runAllTimersAsync();
    expect(await failed).toBe(false);
    expect(selection.getText()).toBeNull();
    expect(element.textContent).toContain("Unable to select all text");
    selection.destroy();
  });

  it("leaves selected input text and host-handled copy events untouched", async () => {
    await write("chosen");
    await selectAll();
    const clipboardData = { setData: vi.fn() };
    const handled = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(handled, "clipboardData", { value: clipboardData });
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(clipboardData.setData).not.toHaveBeenCalled();
    expect(term.getSelectionText()).toBe("chosen\n\n\n");
    const input = document.createElement("input");
    element.appendChild(input);
    input.value = "input";
    input.focus();
    input.select();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(clipboardData.setData).not.toHaveBeenCalled();
    expect(term.getSelectionText()).toBeNull();
  });
});
