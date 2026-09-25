import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellData, TerminalCore } from "@wterm/core";
import { OutputAnnouncements } from "../output-announcements.js";

describe("output announcements", () => {
  let host: HTMLDivElement;
  let output: OutputAnnouncements;
  let core: TerminalCore;
  let screen: string[];
  let history: string[];
  let discarded: number;
  let alternate: boolean;
  let ready: boolean;
  let cols: number;

  const text = () => host.querySelector('[role="log"]')?.textContent;
  const paint = async () => {
    output.rendered();
    await vi.advanceTimersByTimeAsync(501);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    screen = ["", "", "", ""];
    history = [];
    discarded = 0;
    alternate = false;
    ready = true;
    cols = 80;
    host = document.createElement("div");
    host.classList.add("focused");
    document.body.append(host);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const cell = (text: string, col: number): CellData => ({
      char: Array.from(text)[col]?.codePointAt(0) ?? 32,
      fg: 256,
      bg: 256,
      flags: 0,
    });
    core = {
      getCols: () => cols,
      getRows: () => screen.length,
      getScrollbackCount: () => history.length,
      getScrollbackDiscardedCount: () => discarded,
      usingAltScreen: () => alternate,
      getCell: vi.fn((row: number, col: number) => cell(screen[row], col)),
      getScrollbackLineLen: () => cols,
      getScrollbackCell: (offset: number, col: number) =>
        cell(history[history.length - offset - 1], col),
    } as unknown as TerminalCore;
    output = new OutputAnnouncements(
      host,
      () => core,
      () => ready,
    );
  });

  afterEach(() => {
    output.destroy();
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is silent and does no cell work until enabled", async () => {
    screen[0] = "old output";
    await paint();
    expect(text()).toBeUndefined();
    expect(core.getCell).not.toHaveBeenCalled();
    output.setEnabled(true);
    await paint();
    expect(text()).toBe("");
    expect(host.querySelector('[role="log"]')?.getAttribute("aria-live")).toBe(
      "polite",
    );
    screen[1] = "new output";
    await paint();
    expect(text()).toBe("new output");
  });

  it("coalesces redraws and ignores unchanged text and erased rows", async () => {
    output.setEnabled(true);
    screen[0] = "10%";
    output.rendered();
    await vi.advanceTimersByTimeAsync(250);
    screen[0] = "done";
    output.rendered();
    await vi.advanceTimersByTimeAsync(251);
    expect(text()).toBe("done");
    const entry = host.querySelector('[role="log"]')!.firstChild;
    await paint();
    expect(host.querySelector('[role="log"]')!.firstChild).toBe(entry);
    screen[0] = "";
    await paint();
    expect(host.querySelector('[role="log"]')!.firstChild).toBe(entry);
  });

  it("reads lines scrolled into history without repeating unchanged rows", async () => {
    screen = ["one", "two", "three", ""];
    output.setEnabled(true);
    history = ["one", "two", "three", "four", "five"];
    screen = ["six", "seven", "", ""];
    await paint();
    expect(text()).toBe("four\nfive\nsix\nseven");
    history.shift();
    discarded++;
    await paint();
    expect(text()).toBe("four\nfive\nsix\nseven");
  });

  it("preserves full grapheme cells and ignores wide-cell continuations", async () => {
    output.setEnabled(true);
    vi.mocked(core.getCell).mockImplementation((row, col) => {
      const base = { char: 32, fg: 256, bg: 256, flags: 0 };
      if (row) return base;
      if (col === 0) return { ...base, char: 0x8a9e, width: 2 };
      if (col === 1) return { ...base, width: 0 };
      if (col === 2) return { ...base, chars: "e\u0301" };
      if (col === 3) return { ...base, chars: "👩‍💻", width: 2 };
      if (col === 4) return { ...base, width: 0 };
      return { ...base, spacerHead: true };
    });
    await paint();
    expect(text()).toBe("語e\u0301👩‍💻");
  });

  it("waits for a completed paint before reading terminal state", async () => {
    output.setEnabled(true);
    screen[0] = "held";
    output.rendered();
    ready = false;
    await vi.advanceTimersByTimeAsync(501);
    expect(text()).toBe("");
    screen[0] = "complete";
    ready = true;
    await paint();
    expect(text()).toBe("complete");
  });

  it("cancels on blur and does not replay background output on return", async () => {
    output.setEnabled(true);
    screen[0] = "pending";
    output.rendered();
    host.classList.remove("focused");
    host.dispatchEvent(new FocusEvent("focusout"));
    await vi.advanceTimersByTimeAsync(501);
    expect(text()).toBe("");
    screen[0] = "background";
    await paint();
    host.classList.add("focused");
    host.dispatchEvent(new FocusEvent("focusin"));
    await paint();
    expect(text()).toBe("");
    screen[1] = "foreground";
    await paint();
    expect(text()).toBe("foreground");
  });

  it("keeps the first foreground result when focus returns before a pending paint", async () => {
    host.classList.remove("focused");
    output.setEnabled(true);
    screen[0] = "background";
    ready = false;
    host.classList.add("focused");
    host.dispatchEvent(new FocusEvent("focusin"));
    screen[1] = "foreground";
    ready = true;
    await paint();
    expect(text()).toBe("foreground");
  });

  it("silences hidden documents and cancels pending work when disabled or destroyed", async () => {
    output.setEnabled(true);
    screen[0] = "pending";
    output.rendered();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(501);
    expect(text()).toBe("");
    output.setEnabled(false);
    expect(text()).toBeUndefined();
    output.setEnabled(true);
    output.destroy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(text()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rebaselines screen switches and resize instead of rereading old content", async () => {
    output.setEnabled(true);
    alternate = true;
    screen[0] = "editor";
    await paint();
    expect(text()).toBe("");
    screen[0] = "edited";
    await paint();
    expect(text()).toBe("edited");
    alternate = false;
    screen[0] = "old prompt";
    await paint();
    expect(text()).toBe("edited");
    output.invalidate();
    cols = 120;
    await paint();
    expect(text()).toBe("");
  });

  it("bounds burst announcements, publishes one notice, and resumes on input", async () => {
    output.setEnabled(true);
    for (let i = 0; i < 20; i++) {
      screen[0] = `line ${i}`;
      await paint();
    }
    screen[0] = "line 21";
    await paint();
    expect(text()).toContain("announcements paused");
    const notice = host.querySelector('[role="log"]')!.firstChild;
    screen[0] = "line 22";
    await paint();
    expect(host.querySelector('[role="log"]')!.firstChild).toBe(notice);
    output.input();
    screen[0] = "new command";
    await paint();
    expect(text()).toBe("new command");
    expect(host.querySelector('[role="log"]')!.childNodes).toHaveLength(1);
  });

  it("bounds work when output or retained history exceeds the capture budget", async () => {
    output.setEnabled(true);
    vi.mocked(core.getCell).mockClear();
    history = Array.from({ length: 10000 }, () => "line");
    await paint();
    expect(text()).toContain("announcements paused");
    expect(core.getCell).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never publishes a partial oversized grapheme or more than the character limit", async () => {
    output.setEnabled(true);
    vi.mocked(core.getCell).mockReturnValue({
      char: 0,
      chars: "x".repeat(4001),
      fg: 256,
      bg: 256,
      flags: 0,
    });
    await paint();
    expect(text()).toContain("announcements paused");
    expect(text()).not.toContain("xxxx");
  });
});
