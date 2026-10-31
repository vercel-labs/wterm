import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalCore } from "@wterm/core";
import { GhosttyCore } from "../../../ghostty/src/ghostty-core.js";
import { TextCapture } from "../text-capture.js";
import { WTerm } from "../wterm.js";

const wasm = readFileSync(
  resolve(process.cwd(), "../ghostty/wasm/ghostty-vt.wasm"),
);
let core: GhosttyCore;
let term: WTerm;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(wasm)),
  );
  core = await GhosttyCore.load({ wasmPath: "https://wterm.test/output.wasm" });
  host = document.createElement("div");
  document.body.append(host);
  vi.useFakeTimers();
  term = new WTerm(host, { core, cols: 6, rows: 4, autoResize: false });
  await term.init();
});
afterEach(() => {
  term.destroy();
  core.dispose();
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("terminal text snapshots", () => {
  it("captures retained history, wraps, Unicode and blank lines without changing focus or selection", async () => {
    term.write("abcde界e\u0301😀xyz\r\n\r\nlast");
    const selected = term.selectAll();
    await vi.runAllTimersAsync();
    expect(await selected).toBe(true);
    const focused = document.activeElement;
    const text = term.readText();
    await vi.runAllTimersAsync();
    expect(await text).toBe("abcde界e\u0301😀xyz\n\nlast");
    expect(document.activeElement).toBe(focused);
    expect(term.getSelectionText()).toBe(await text);
    expect(host.classList.contains("term-select-all")).toBe(true);
    term.write("new");
    term.resize(12, 4);
    expect(await text).toBe("abcde界e\u0301😀xyz\n\nlast");
  });

  it.each(["write", "resize", "destroy", "abort", "replace"])(
    "rejects incomplete captures on %s",
    async (action) => {
      const abort = new AbortController();
      const result = term
        .readText({ signal: abort.signal })
        .catch((error) => error);
      if (action === "write") term.write("changed");
      if (action === "resize") term.resize(10, 4);
      if (action === "destroy") term.destroy();
      if (action === "abort") abort.abort();
      if (action === "replace") {
        const replacement = term.readText();
        await vi.runAllTimersAsync();
        expect(await replacement).toBe("\n\n\n");
      }
      await vi.runAllTimersAsync();
      expect(await result).toMatchObject({ name: "AbortError" });
    },
  );

  it("waits for the visible frame and rejects captures spanning a synchronized update", async () => {
    term.write("old");
    await vi.runAllTimersAsync();
    term.write("\x1b[?2026h\x1b[Hnew");
    let finished = false;
    const result = term
      .readText()
      .finally(() => {
        finished = true;
      })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toBe(false);
    term.write("\x1b[?2026l");
    expect(await result).toMatchObject({ name: "AbortError" });
    const fresh = term.readText();
    await vi.runAllTimersAsync();
    expect(await fresh).toBe("new\n\n\n");
  });

  it("aborts between slices, stops reading, and releases the abort listener", async () => {
    const read = vi.fn(() => 0);
    const large = {
      getScrollbackCount: () => 100000,
      getRows: () => 0,
      getScrollbackLineLen: read,
    } as unknown as TerminalCore;
    const capture = new TextCapture();
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    const result = capture.read(abort.signal).catch((error) => error);
    capture.resume(large);
    await vi.advanceTimersToNextTimerAsync();
    expect(read.mock.calls.length).toBeGreaterThan(0);
    expect(read.mock.calls.length).toBeLessThan(100000);
    abort.abort();
    const count = read.mock.calls.length;
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(read).toHaveBeenCalledTimes(count);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("releases successful requests and rejects pre-aborted signals", async () => {
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    const result = term.readText({ signal: abort.signal });
    await vi.runAllTimersAsync();
    expect(await result).toBe("\n\n\n");
    expect(remove).toHaveBeenCalledOnce();
    abort.abort();
    await expect(term.readText({ signal: abort.signal })).rejects.toMatchObject(
      { name: "AbortError" },
    );
  });

  it("rejects oversized output and extraction errors without returning partial text", async () => {
    const capture = new TextCapture();
    const large = {
      getScrollbackCount: () => 0,
      getRows: () => 1,
      getCols: () => 2,
      getCell: () => ({ chars: "x".repeat(16 * 1024 * 1024) }),
    } as unknown as TerminalCore;
    const result = capture.read().catch((error) => error);
    capture.resume(large);
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(RangeError);
    const failed = capture.read().catch((error) => error);
    const error = new Error("Unavailable");
    large.getCell = () => {
      throw error;
    };
    capture.resume(large);
    await vi.runAllTimersAsync();
    expect(await failed).toBe(error);
  });

  it("rejects reads after destruction", async () => {
    term.destroy();
    await expect(term.readText()).rejects.toThrow("not initialized");
  });
});
