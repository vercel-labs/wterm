import { WasmBridge } from "@wterm/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WTerm } from "../wterm.js";

describe("synchronized output generation probe", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("gives each real WASM generation a fresh recovery deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(performance.now());
      return 1;
    });

    const bridge = await WasmBridge.load();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const term = new WTerm(element, {
      autoResize: false,
      core: bridge,
    });
    await term.init();
    const clearDirty = vi.spyOn(bridge, "clearDirty");
    clearDirty.mockClear();

    term.write("\x1b[?2026hA");
    await vi.advanceTimersByTimeAsync(600);
    term.write("\x1b[?2026l\x1b[?2026hB");
    await vi.advanceTimersByTimeAsync(999);

    expect(bridge.synchronizedOutputGeneration()).toBe(2);
    expect(clearDirty).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(clearDirty).toHaveBeenCalledTimes(1);
    term.destroy();
  });

  it("keeps a fixed recovery deadline across ordinary payload", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(performance.now());
      return 1;
    });

    const bridge = await WasmBridge.load();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const term = new WTerm(element, {
      autoResize: false,
      core: bridge,
    });
    await term.init();
    const clearDirty = vi.spyOn(bridge, "clearDirty");
    clearDirty.mockClear();

    term.write("\x1b[?2026hA");
    await vi.advanceTimersByTimeAsync(900);
    term.write("B");
    await vi.advanceTimersByTimeAsync(101);

    expect(clearDirty).toHaveBeenCalledTimes(1);
    term.destroy();
  });
});
