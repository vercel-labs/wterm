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
  it("releases tracked edges when selections change and when the terminal is destroyed", async () => {
    await write("abcdef");
    for (let i = 0; i < 70; i++) {
      select(0, i % 3, 0, 4 + (i % 3));
      await write("\x1b[H");
      expect(term.getSelectionText()).not.toBeNull();
    }
    term.destroy();
    const handles = Array.from({ length: 64 }, () =>
      core.trackPosition({ row: 0, col: 0 }),
    );
    expect(handles.every(Boolean)).toBe(true);
    handles.forEach((handle) => handle?.dispose());
  });

  it("leaves a selection in another input alone while a render is pending", async () => {
    await write("abcdef");
    select(0, 0, 0, 3);
    term.resize(12, 4);
    const input = document.createElement("textarea");
    input.value = "outside";
    document.body.appendChild(input);
    input.focus();
    input.select();
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe(input);
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe(
      "outside",
    );
    expect(term.getSelectionText()).toBeNull();
    input.remove();
  });
  it("preserves a full hard row and explicit newlines when padding changes width", async () => {
    await write("abc\r\n\r\nx");
    select(0, 0, 0, 6);
    term.resize(12, 4);
    await vi.runAllTimersAsync();
    expect(term.getSelectionText()).toBe("abc");
    select(0, 0, 2, 0);
    term.resize(4, 4);
    await vi.runAllTimersAsync();
    expect(term.getSelectionText()).toBe("abc\n\n");
  });

  it("preserves a selection through synchronized output and resize until release", async () => {
    await write("abcdefghij");
    select(0, 2, 1, 4);
    term.write("\x1b[?2026h\r\nnext");
    term.resize(4, 4);
    await vi.advanceTimersByTimeAsync(100);
    expect(term.getSelectionText()).toBe("cdefghij");
    term.write("\x1b[?2026l");
    await vi.runAllTimersAsync();
    expect(term.getSelectionText()).toBe("cdefghij");
  });

  it("clears a tracked selection when reflow would retain too many rows", async () => {
    term.resize(100, 24);
    await vi.runAllTimersAsync();
    await write("x".repeat(1100));
    select(0, 0, 10, 100);
    term.resize(1, 24);
    await vi.runAllTimersAsync();
    expect(term.getSelectionText()).toBeNull();
    expect(element.querySelectorAll(".term-row").length).toBeLessThan(100);
  });
  it("preserves forward and backward selections through narrower and wider reflow", async () => {
    for (const backward of [false, true]) {
      await write("\x1bcabcdefghijklmno\r\nlast");
      select(0, 2, 2, 3, backward);
      term.resize(4, 4);
      await vi.runAllTimersAsync();
      expect(term.getSelectionText()).toBe("cdefghijklmno");
      const selection = document.getSelection()!;
      const range = selection.getRangeAt(0);
      expect(
        selection.anchorNode === range.startContainer &&
          selection.anchorOffset === range.startOffset,
      ).toBe(!backward);
      term.resize(12, 4);
      await vi.runAllTimersAsync();
      expect(term.getSelectionText()).toBe("cdefghijklmno");
      term.resize(6, 4);
      await vi.runAllTimersAsync();
    }
  });

  it("follows selected Unicode cells into scrollback and through reflow", async () => {
    await write("abcde界e\u0301😀uvwxyz");
    select(0, 3, 2, 5);
    const selected = term.getSelectionText();
    await write("\r\nnext\r\nnext\r\nnext");
    expect(term.getSelectionText()).toBe(selected);
    term.resize(10, 4);
    await vi.runAllTimersAsync();
    expect(term.getSelectionText()).toBe(selected);
  });

  it("clears overwritten text, but preserves selection through style and cursor changes", async () => {
    await write("abcdef");
    select(0, 0, 0, 3);
    await write("\x1b[H\x1b[31mabc");
    expect(term.getSelectionText()).toBe("abc");
    await write("\x1b[Hnew");
    expect(term.getSelectionText()).toBeNull();
    select(0, 0, 0, 3);
    await write("\x1b[?1049h\x1b[?1049l");
    expect(term.getSelectionText()).toBeNull();
  });

  it("does not restore a cleared or replaced selection during a pending frame", async () => {
    await write("abcdefghij");
    select(0, 0, 1, 4);
    term.resize(4, 4);
    document.getSelection()!.removeAllRanges();
    await vi.runAllTimersAsync();
    expect(term.getSelectionText()).toBeNull();
  });

  it("mounts selected history separately from a distant viewport and clears pruned text", async () => {
    Object.defineProperty(element, "clientHeight", { value: 68 });
    Object.defineProperty(element, "scrollHeight", {
      get: () => (core.getScrollbackCount() + core.getRows()) * 17,
    });
    await write("chosen\r\n");
    select(0, 0, 0, 6);
    await write("line\r\n".repeat(500));
    expect(term.getSelectionText()).toBe("chosen");
    expect(element.querySelectorAll(".term-row").length).toBeLessThan(40);
    expect(element.querySelectorAll(".term-scrollback-spacer").length).toBe(3);
    await write("line\r\n".repeat(20000));
    expect(term.getSelectionText()).toBeNull();
  });
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
