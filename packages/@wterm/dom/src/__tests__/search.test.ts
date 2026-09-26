import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhosttyCore } from "../../../ghostty/src/ghostty-core.js";
import { scanSearch, SearchController } from "../search.js";
import { WTerm } from "../wterm.js";

const wasm = readFileSync(
  resolve(process.cwd(), "../ghostty/wasm/ghostty-vt.wasm"),
);
let core: GhosttyCore;
let terminal: WTerm | undefined;
let element: HTMLDivElement;
beforeEach(async () => {
  // Fake timers do not drive native MessagePorts. Exercise the timer fallback
  // here; the message-task tests below control dispatch explicitly.
  vi.stubGlobal("MessageChannel", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(wasm)),
  );
  core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/search.wasm",
    scrollbackLimit: 1024,
  });
  core.init(6, 4);
  element = document.createElement("div");
  document.body.appendChild(element);
});
afterEach(() => {
  terminal?.destroy();
  terminal = undefined;
  core.dispose();
  element.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function find(query: string, caseSensitive = false) {
  return Array.from(scanSearch(core, query, caseSensitive)).filter(
    (match) => match !== null,
  );
}
async function mount() {
  vi.useFakeTimers();
  terminal = new WTerm(element, { core, cols: 6, rows: 4, autoResize: false });
  await terminal.init();
  return terminal;
}

describe("cell-aware search", () => {
  it("finds overlapping matches across soft wraps and the history/live boundary", () => {
    core.writeString("abababababababa\r\nlast");
    core.resize(6, 2);
    expect(core.getScrollbackCount()).toBe(2);
    const matches = find("ababa");
    expect(matches).toHaveLength(6);
    expect(matches[4]).toEqual({
      start: { row: 1, col: 2, endCol: 3 },
      end: { row: 2, col: 0, endCol: 1 },
    });
  });

  it("never joins explicit newlines or unknown wrap boundaries", () => {
    core.writeString("abcdef\r\nghijkl");
    expect(find("fgh")).toEqual([]);
    core.init(6, 4);
    core.writeString("abcdefgh");
    expect(find("fgh")).toHaveLength(1);
    core.getRowMetadata = () => null;
    expect(find("fgh")).toEqual([]);
  });

  it("omits wide-character spacer heads in live rows and history", () => {
    core.writeString("abcde界!");
    expect(core.getCell(0, 5).spacerHead).toBe(true);
    expect(find("de界!")).toEqual([
      {
        start: { row: 0, col: 3, endCol: 4 },
        end: { row: 1, col: 2, endCol: 3 },
      },
    ]);
    expect(find("de 界")).toEqual([]);
    core.writeString("\r\n1\r\n2\r\n3\r\n4");
    expect(find("de界!")).toHaveLength(1);
    expect(
      core.getScrollbackCell(core.getScrollbackCount() - 1, 5).spacerHead,
    ).toBe(true);
  });

  it("maps combining marks, surrogate pairs and wide cells to whole cells", () => {
    core.init(30, 4);
    core.writeString("e\u0301界😀x");
    expect(find("\u0301界😀")).toEqual([
      {
        start: { row: 0, col: 0, endCol: 1 },
        end: { row: 0, col: 3, endCol: 5 },
      },
    ]);
    expect(find("x")[0].start.col).toBe(5);
    expect(find("é")).toEqual([]);
  });

  it("uses per-code-point lowercase without normalization or full case folding", () => {
    core.init(30, 4);
    core.writeString("İ Σς ß AaA");
    expect(find("i\u0307")[0].start.col).toBe(0);
    expect(find("σ")).toHaveLength(1);
    expect(find("ss")).toHaveLength(0);
    expect(find("aa")).toHaveLength(2);
    expect(find("Aa", true)).toHaveLength(1);
    core.init(30, 4);
    core.writeString("ΟΣ Ος 𐐀𐐁");
    // Lowercasing the whole query would incorrectly turn the final Σ into ς.
    expect(find("ΟΣ")).toEqual(find("οσ"));
    expect(find("ΟΣ")).toHaveLength(1);
    expect(find("𐐨𐐩")).toHaveLength(1);
    expect(find("𐐨𐐩", true)).toHaveLength(0);
  });

  it("retains real spaces, treats query metacharacters literally, and yields on blank history", () => {
    core.writeString("a  b.*");
    expect(find("  ")[0].start.col).toBe(1);
    expect(find(".*")).toHaveLength(1);
    core.writeString("\r\n".repeat(1000));
    const scanner = scanSearch(core, "missing", true);
    expect(scanner.next()).toEqual({ value: null, done: false });
  });
});

describe("search task scheduling", () => {
  function tasks() {
    const pending: (() => void)[] = [];
    const channels: TestChannel[] = [];
    class TestChannel {
      port1 = { onmessage: null as (() => void) | null, close: vi.fn() };
      port2 = {
        postMessage: () => pending.push(this.port1.onmessage!),
        close: vi.fn(),
      };
      constructor() {
        channels.push(this);
      }
    }
    vi.stubGlobal("MessageChannel", TestChannel);
    return { pending, channels };
  }

  it("uses the time budget rather than stopping after a fixed cell count", () => {
    const { pending, channels } = tasks();
    core.init(1000, 20);
    vi.spyOn(performance, "now").mockReturnValue(0);
    const controller = new SearchController(() => {});
    controller.search("absent", {});
    controller.resume(core);
    expect(controller.snapshot().searching).toBe(true);
    pending.shift()!();
    expect(controller.snapshot()).toMatchObject({ count: 0, searching: false });
    expect(pending).toHaveLength(0);
    expect(channels[0].port1.close).toHaveBeenCalledOnce();
    expect(channels[0].port2.close).toHaveBeenCalledOnce();
  });

  it.each(["cancel", "replace"])(
    "yields for input and honors reentrant %s without delivering stale tasks",
    (action) => {
      const { pending, channels } = tasks();
      core.init(1000, 20);
      core.writeString("target");
      let clock = 0;
      vi.spyOn(performance, "now").mockImplementation(() => clock);
      const getCell = core.getCell.bind(core);
      const reads = vi.spyOn(core, "getCell").mockImplementation((row, col) => {
        clock += 0.01;
        return getCell(row, col);
      });
      const changed = vi.fn((reveal: boolean) => {
        if (!reveal) return;
        if (action === "cancel") controller.cancel();
        else {
          controller.search("absent", {});
          controller.resume(core);
        }
      });
      const controller = new SearchController(changed);
      controller.search("target", {});
      controller.resume(core);
      expect(reads).not.toHaveBeenCalled();
      const stale = pending.shift()!;
      stale();
      expect(reads.mock.calls.length).toBeGreaterThan(0);
      expect(reads.mock.calls.length).toBeLessThan(1000);
      expect(channels[0].port1.close).toHaveBeenCalledOnce();
      expect(channels[0].port2.close).toHaveBeenCalledOnce();
      expect(controller.snapshot()).toMatchObject({
        query: action === "cancel" ? "target" : "absent",
        count: 0,
        searching: action === "replace",
      });
      changed.mockClear();
      reads.mockClear();
      stale();
      expect(reads).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      while (pending.length) pending.shift()!();
      expect(controller.snapshot().searching).toBe(false);
      for (const channel of channels) {
        expect(channel.port1.close).toHaveBeenCalledOnce();
        expect(channel.port2.close).toHaveBeenCalledOnce();
      }
    },
  );
});

describe("search lifecycle", () => {
  it("publishes incremental results, wraps navigation, and clears or replaces work", async () => {
    const term = await mount();
    term.write("target\r\ntarget");
    const states = vi.fn();
    term.onSearchChange = states;
    term.search("target");
    expect(term.getSearchState().searching).toBe(true);
    await vi.runAllTimersAsync();
    expect(term.getSearchState()).toMatchObject({
      count: 2,
      activeIndex: 0,
      searching: false,
    });
    term.findPrevious();
    expect(term.getSearchState().activeIndex).toBe(1);
    term.findNext();
    expect(term.getSearchState().activeIndex).toBe(0);
    term.search("target");
    term.search("absent");
    await vi.runAllTimersAsync();
    expect(term.getSearchState()).toMatchObject({ query: "absent", count: 0 });
    term.search("target");
    term.clearSearch();
    await vi.runAllTimersAsync();
    expect(term.getSearchState()).toMatchObject({
      query: "",
      count: 0,
      searching: false,
    });
    expect(term.findNext()).toBe(false);
    expect(states).toHaveBeenCalled();
  });

  it("invalidates results synchronously on output, reflow, pruning and screen switches", async () => {
    const term = await mount();
    term.write("abcdefghijk");
    term.search("efgh");
    await vi.runAllTimersAsync();
    expect(term.getSearchState().count).toBe(1);
    term.resize(4, 4);
    expect(term.getSearchState().count).toBe(0);
    await vi.runAllTimersAsync();
    expect(term.getSearchState().count).toBe(1);
    term.write("\x1b[?1049h");
    await vi.runAllTimersAsync();
    expect(term.getSearchState().count).toBe(0);
    term.write("\x1b[?1049l");
    await vi.runAllTimersAsync();
    expect(term.getSearchState().count).toBe(1);
    term.write("x".repeat(120000));
    expect(core.getScrollbackDiscardedCount()).toBeGreaterThan(0);
    await vi.runAllTimersAsync();
    expect(term.getSearchState().count).toBe(0);
  });

  it("waits for synchronized output to paint and cancels on destruction", async () => {
    const term = await mount();
    term.write("\x1b[?2026htarget");
    term.search("target");
    await vi.advanceTimersByTimeAsync(100);
    expect(term.getSearchState()).toMatchObject({ count: 0, searching: true });
    term.write("\x1b[?2026l");
    await vi.runAllTimersAsync();
    expect(term.getSearchState().count).toBe(1);
    const changed = vi.fn();
    term.onSearchChange = changed;
    term.search("target");
    changed.mockClear();
    term.destroy();
    await vi.runAllTimersAsync();
    expect(changed).not.toHaveBeenCalled();
    expect(term.findNext()).toBe(false);
    expect(term.getSearchState()).toMatchObject({ count: 0, searching: false });
  });

  it("limits result memory and rejects overlong queries without replacing the current search", async () => {
    vi.useFakeTimers();
    core.init(1000, 20);
    core.writeString("a".repeat(11000));
    const controller = new SearchController(() => {});
    controller.search("a", {});
    controller.resume(core);
    await vi.runAllTimersAsync();
    expect(controller.snapshot()).toMatchObject({
      count: 10000,
      limited: true,
      searching: false,
    });
    expect(() => controller.search("x".repeat(1025), {})).toThrow(RangeError);
    expect(controller.snapshot().query).toBe("a");
  });

  it("allows the host to cancel from a progress callback", async () => {
    vi.useFakeTimers();
    core.writeString("abc");
    const controller = new SearchController(() => {
      if (controller.snapshot().count) controller.search("", {});
    });
    controller.search("a", {});
    controller.resume(core);
    await vi.runAllTimersAsync();
    expect(controller.snapshot()).toMatchObject({
      count: 0,
      query: "",
      searching: false,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
