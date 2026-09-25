import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhosttyCore } from "../../../ghostty/src/ghostty-core.js";
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
  document.getSelection()?.removeAllRanges();
  term.destroy();
  core.dispose();
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function write(text: string) {
  term.write(text);
  await vi.runAllTimersAsync();
}
function point(row: number, offset: number): [Node, number] {
  const element = document.querySelectorAll(".term-row")[row];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (offset <= node.textContent!.length) return [node, offset];
    offset -= node.textContent!.length;
  }
  throw new Error("Invalid selection offset");
}
function select(
  startRow: number,
  start: number,
  endRow: number,
  end: number,
  backward = false,
) {
  const anchor = point(startRow, start),
    focus = point(endRow, end);
  document
    .getSelection()!
    .setBaseAndExtent(
      ...(backward ? focus : anchor),
      ...(backward ? anchor : focus),
    );
}
function copy(target: EventTarget = document) {
  const clipboardData = { setData: vi.fn() };
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  target.dispatchEvent(event);
  return { event, clipboardData };
}

describe("terminal selection text", () => {
  it("joins confirmed soft wraps and preserves explicit newlines in either direction", async () => {
    await write("abcdefghij\r\nnext");
    select(0, 2, 2, 4);
    expect(term.getSelectionText()).toBe("cdefghij\nnext");
    select(0, 2, 2, 4, true);
    expect(term.getSelectionText()).toBe("cdefghij\nnext");
    const { event, clipboardData } = copy();
    expect(event.defaultPrevented).toBe(true);
    expect(clipboardData.setData).toHaveBeenCalledExactlyOnceWith(
      "text/plain",
      "cdefghij\nnext",
    );
  });

  it("keeps a newline at the exact right edge and falls back conservatively for unknown metadata", async () => {
    await write("abcdef\r\nghij");
    select(0, 0, 1, 4);
    expect(term.getSelectionText()).toBe("abcdef\nghij");
    core.getRowMetadata = () => null;
    await write("\x1bcabcdefghij");
    select(0, 0, 1, 4);
    expect(term.getSelectionText()).toBe("abcdef\nghij");
  });

  it("omits wide spacer heads and expands partial graphemes and surrogate pairs", async () => {
    await write("abcde界e\u0301😀");
    select(0, 3, 1, 4);
    expect(term.getSelectionText()).toBe("de界e\u0301😀");
    select(1, 2, 1, 3);
    expect(term.getSelectionText()).toBe("e\u0301");
    select(1, 4, 1, 5);
    expect(term.getSelectionText()).toBe("😀");
    select(0, 5, 0, 6);
    expect(term.getSelectionText()).toBe("");
  });

  it("trims spaces at a selected hard row end but keeps interior and explicitly selected partial-row spaces", async () => {
    await write("a  b\r\nx");
    select(0, 0, 1, 1);
    expect(term.getSelectionText()).toBe("a  b\nx");
    select(0, 0, 0, 5);
    expect(term.getSelectionText()).toBe("a  b ");
    select(0, 0, 0, 6);
    expect(term.getSelectionText()).toBe("a  b");
    await write("\x1bcabc   def");
    select(0, 0, 1, 3);
    expect(term.getSelectionText()).toBe("abc   def");
  });

  it("preserves selected blank lines and an explicit newline ending at the next row start", async () => {
    await write("a\r\n\r\nb");
    select(0, 0, 2, 1);
    expect(term.getSelectionText()).toBe("a\n\nb");
    select(0, 0, 1, 0);
    expect(term.getSelectionText()).toBe("a\n");
    const row = element.querySelector(".term-row")!;
    const range = document.createRange();
    range.selectNodeContents(row);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(term.getSelectionText()).toBe("a");
  });

  it("copies block, box, and linked glyph text without exporting hyperlink markup", async () => {
    await write("\x1b]8;;https://example.com\x1b\\▀▄█│\x1b]8;;\x1b\\");
    select(0, 0, 0, 4);
    expect(term.getSelectionText()).toBe("▀▄█│");
    expect(element.querySelectorAll(".term-block")).toHaveLength(3);
    expect(copy().clipboardData.setData).toHaveBeenCalledExactlyOnceWith(
      "text/plain",
      "▀▄█│",
    );
  });

  it("copies the painted snapshot while newer output waits for a frame or synchronized release", async () => {
    await write("abcdefghij");
    select(0, 0, 1, 4);
    term.write("\x1b[Hchanged");
    expect(term.getSelectionText()).toBe("abcdefghij");
    await vi.runAllTimersAsync();
    await write("\x1bcabcdefghij");
    select(0, 0, 1, 4);
    term.write("\x1b[?2026h\x1b[2J\x1b[Hnew");
    await vi.advanceTimersByTimeAsync(100);
    expect(term.getSelectionText()).toBe("abcdefghij");
    expect(copy().clipboardData.setData).toHaveBeenCalledExactlyOnceWith(
      "text/plain",
      "abcdefghij",
    );
  });

  it("does not replace unchanged text nodes when a render occurs", async () => {
    await write("abcdef");
    select(0, 0, 0, 4);
    const node = document.getSelection()!.anchorNode;
    term.search("missing");
    await vi.runAllTimersAsync();
    expect(document.getSelection()!.anchorNode).toBe(node);
    expect(term.getSelectionText()).toBe("abcd");
  });

  it("joins history to the live screen and uses refreshed wrap metadata after reflow", async () => {
    await write("abcdefghijklmnopqrstu");
    term.resize(6, 2);
    await vi.runAllTimersAsync();
    expect(core.getScrollbackCount()).toBeGreaterThan(0);
    select(0, 2, 3, 3);
    expect(term.getSelectionText()).toBe("cdefghijklmnopqrstu");
    term.resize(10, 4);
    await vi.runAllTimersAsync();
    select(0, 2, 2, 1);
    expect(term.getSelectionText()).toBe("cdefghijklmnopqrstu");
  });

  it("leaves empty, external, mixed-page, and edited DOM selections to the browser", async () => {
    expect(term.getSelectionText()).toBeNull();
    await write("abc");
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    const range = document.createRange();
    range.setStart(...point(0, 0));
    range.setEnd(outside.firstChild!, 3);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(term.getSelectionText()).toBeNull();
    expect(copy().event.defaultPrevented).toBe(false);
    outside.remove();
    select(0, 0, 0, 3);
    point(0, 0)[0].textContent = "edited";
    expect(term.getSelectionText()).toBeNull();
  });

  it("defers a selection that spans unmounted history rather than joining across the gap", async () => {
    Object.defineProperty(element, "clientHeight", { value: 68 });
    Object.defineProperty(element, "scrollHeight", {
      get: () => (core.getScrollbackCount() + core.getRows()) * 17,
    });
    await write("line\r\n".repeat(200));
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
    await vi.runAllTimersAsync();
    const range = document.createRange();
    range.selectNodeContents(element.querySelector(".term-grid")!);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(element.querySelectorAll(".term-row").length).toBeLessThan(200);
    expect(term.getSelectionText()).toBeNull();
    expect(copy().event.defaultPrevented).toBe(false);
  });

  it("owns a wrap snapshot even when a custom core reuses a metadata object", async () => {
    const metadata = { wrapsToNext: false, continuesPrevious: false };
    core.getRowMetadata = () => metadata;
    await write("abcdef\r\nghij");
    select(0, 0, 1, 4);
    metadata.wrapsToNext = true;
    metadata.continuesPrevious = true;
    expect(term.getSelectionText()).toBe("abcdef\nghij");
  });

  it("respects input selections, host copy handlers, unavailable clipboard data and teardown", async () => {
    await write("abc");
    select(0, 0, 0, 3);
    const input = document.createElement("input");
    input.value = "input";
    document.body.appendChild(input);
    input.focus();
    input.select();
    expect(copy(input).event.defaultPrevented).toBe(false);
    input.remove();
    select(0, 0, 0, 3);
    const event = new Event("copy", { bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    const handled = new Event("copy", { bubbles: true, cancelable: true });
    const setData = vi.fn();
    Object.defineProperty(handled, "clipboardData", { value: { setData } });
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(setData).not.toHaveBeenCalled();
    term.destroy();
    expect(term.getSelectionText()).toBeNull();
    expect(copy().event.defaultPrevented).toBe(false);
  });
});
