import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GhosttyCore } from "../../../ghostty/src/ghostty-core.js";
import { rectangleSelection } from "../rectangle-selection.js";
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
  vi.stubGlobal("MessageChannel", undefined);
  core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/rectangle.wasm",
  });
  vi.useFakeTimers();
  element = document.createElement("div");
  document.body.append(element);
  term = new WTerm(element, { core, cols: 8, rows: 4, autoResize: false });
  await term.init();
});
afterEach(() => {
  term.destroy();
  core.dispose();
  element.remove();
  document.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function write(text: string) {
  term.write(text);
  await vi.runAllTimersAsync();
}
const start = { row: 0, col: 1 },
  end = { row: 2, col: 3 };

it("copies physical columns in either direction, preserving selected spaces", async () => {
  await write("0123456789abcdef\r\nx  y");
  for (const [a, b] of [
    [start, end],
    [end, start],
    [
      { row: 0, col: 3 },
      { row: 2, col: 1 },
    ],
  ]) {
    expect(term.selectRectangle(a, b)).toBe(true);
    expect(term.getSelectionText()).toBe("123\n9ab\n  y");
  }
  expect(term.selectRectangle({ row: 3, col: 0 }, { row: 3, col: 2 })).toBe(
    true,
  );
  expect(term.getSelectionText()).toBe("   ");
});

it("expands wide edges, keeps graphemes, and omits spacer heads", async () => {
  await write("a界e\u0301😀z\r\n1234567界");
  const rectangle = rectangleSelection(
    core,
    { row: 0, col: 2 },
    { row: 0, col: 4 },
  );
  expect(rectangle).toEqual({
    text: "界e\u0301😀",
    rows: [{ row: 0, left: 1, right: 6 }],
  });
  expect(
    rectangleSelection(core, { row: 1, col: 6 }, { row: 2, col: 7 })?.text,
  ).toBe("7\n  ");
});

it("reads unmounted history without increasing the mounted window", async () => {
  await write("first123\r\nsecond45\r\n" + "later\r\n".repeat(200));
  const mounted = element.querySelectorAll(".term-row").length;
  expect(term.selectRectangle({ row: 0, col: 0 }, { row: 1, col: 4 })).toBe(
    true,
  );
  expect(term.getSelectionText()).toBe("first\nsecon");
  expect(element.querySelectorAll(".term-row").length).toBe(mounted);
});

it("rejects invalid or oversized rectangles without replacing a valid selection", async () => {
  await write("selected");
  expect(term.selectRectangle({ row: 0, col: 0 }, { row: 0, col: 7 })).toBe(
    true,
  );
  for (const point of [
    { row: -1, col: 0 },
    { row: 4, col: 0 },
    { row: 0, col: 8 },
    { row: NaN, col: 0 },
    { row: 0, col: 0.5 },
  ])
    expect(term.selectRectangle(point, end)).toBe(false);
  expect(term.getSelectionText()).toBe("selected");
  const rows = vi.spyOn(core, "getRows").mockReturnValue(1001);
  const read = vi.spyOn(core, "getCell");
  expect(
    rectangleSelection(core, { row: 0, col: 0 }, { row: 1000, col: 0 }),
  ).toBeNull();
  expect(read).not.toHaveBeenCalled();
  rows.mockReturnValue(100);
  vi.spyOn(core, "getCols").mockReturnValue(1024);
  expect(
    rectangleSelection(core, { row: 0, col: 0 }, { row: 99, col: 1023 }),
  ).toBeNull();
  expect(read).not.toHaveBeenCalled();
  rows.mockRestore();
  read.mockReturnValue({
    char: 65,
    fg: 256,
    bg: 256,
    flags: 0,
    chars: "a".repeat(1024 * 1024 + 1),
  });
  expect(
    rectangleSelection(core, { row: 0, col: 0 }, { row: 0, col: 0 }),
  ).toBeNull();
});

it.each(["write", "resize", "destroy", "escape", "input", "clear"])(
  "clears the snapshot on %s",
  async (action) => {
    await write("01234567\r\nabcdefgh\r\nABCDEFGH");
    expect(term.selectRectangle(start, end)).toBe(true);
    if (action === "write") term.write("x");
    if (action === "resize") term.resize(10, 4);
    if (action === "destroy") term.destroy();
    if (action === "clear") term.clearSelection();
    if (action === "escape" || action === "input")
      element.querySelector("textarea")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: action === "escape" ? "Escape" : "x",
          bubbles: true,
          cancelable: true,
        }),
      );
    expect(term.getSelectionText()).toBeNull();
    expect(element.querySelectorAll(".term-rectangle-row")).toHaveLength(0);
  },
);

it("defers unseen output and aborts reentrant focus mutations", async () => {
  await write("old");
  term.write("\x1b[?2026h\x1b[Hnew");
  expect(term.selectRectangle(start, end)).toBe(false);
  term.write("\x1b[?2026l");
  await vi.runAllTimersAsync();
  term.write("\x1b[?1004h");
  await vi.runAllTimersAsync();
  element.querySelector("textarea")!.blur();
  term.onData = () => term.write("changed");
  expect(term.selectRectangle(start, end)).toBe(false);
  expect(term.getSelectionText()).toBeNull();
});

it("shares ownership with Select All and yields to external selection and focus", async () => {
  await write("01234567\r\nabcdefgh\r\nABCDEFGH");
  const all = term.selectAll();
  expect(term.selectRectangle(start, end)).toBe(true);
  expect(await all).toBe(false);
  expect(element.classList.contains("term-select-all")).toBe(false);
  const other = document.createElement("p");
  other.textContent = "outside";
  document.body.append(other);
  document
    .getSelection()!
    .setBaseAndExtent(other.firstChild!, 0, other.firstChild!, 7);
  expect(term.getSelectionText()).toBeNull();
  expect(document.getSelection()!.toString()).toBe("outside");
  other.remove();
});
