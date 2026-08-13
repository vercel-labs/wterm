import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { WasmBridge } from "@wterm/core";

function createMockBridge(): WasmBridge {
  return {
    init: vi.fn(),
    writeString: vi.fn(),
    writeRaw: vi.fn(),
    resize: vi.fn(),
    getRows: vi.fn(() => 24),
    getCols: vi.fn(() => 80),
    getCell: vi.fn(() => ({ char: 0, fg: 256, bg: 256, flags: 0 })),
    isDirtyRow: vi.fn(() => true),
    clearDirty: vi.fn(),
    getCursor: vi.fn(() => ({ row: 0, col: 0, visible: true })),
    getScrollbackCount: vi.fn(() => 0),
    getScrollbackCell: vi.fn(() => ({ char: 0, fg: 256, bg: 256, flags: 0 })),
    getScrollbackLineLen: vi.fn(() => 0),
    getTitle: vi.fn(() => null),
    getResponse: vi.fn(() => null),
    cursorKeysApp: vi.fn(() => false),
    bracketedPaste: vi.fn(() => false),
    usingAltScreen: vi.fn(() => false),
    mouseTracking: vi.fn(() => 0),
    mouseSgr: vi.fn(() => false),
    synchronizedOutput: vi.fn(() => false),
    getScrollbackDiscardedCount: vi.fn(() => 0),
  } as unknown as WasmBridge;
}

let mockBridge: WasmBridge;

vi.mock("@wterm/core", () => ({
  WasmBridge: {
    load: vi.fn(),
  },
}));

import { WasmBridge as MockedWasmBridge } from "@wterm/core";
import { WTerm } from "../wterm.js";
import { Renderer } from "../renderer.js";

describe("WTerm", () => {
  let element: HTMLDivElement;

  beforeEach(() => {
    mockBridge = createMockBridge();
    vi.mocked(MockedWasmBridge.load).mockResolvedValue(mockBridge);

    element = document.createElement("div");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates a term-grid container inside the element", () => {
      new WTerm(element);
      expect(element.querySelector(".term-grid")).not.toBeNull();
    });

    it("adds the wterm class to the element", () => {
      new WTerm(element);
      expect(element.classList.contains("wterm")).toBe(true);
    });

    it("adds cursor-blink class when option is set", () => {
      new WTerm(element, { cursorBlink: true });
      expect(element.classList.contains("cursor-blink")).toBe(true);
    });

    it("does not add cursor-blink class by default", () => {
      new WTerm(element);
      expect(element.classList.contains("cursor-blink")).toBe(false);
    });

    it("defaults to 80 cols and 24 rows", () => {
      const term = new WTerm(element);
      expect(term.cols).toBe(80);
      expect(term.rows).toBe(24);
    });

    it("accepts custom cols and rows", () => {
      const term = new WTerm(element, { cols: 120, rows: 40 });
      expect(term.cols).toBe(120);
      expect(term.rows).toBe(40);
    });
  });

  describe("hyperlink activation", () => {
    it.each([
      ["MacIntel", "Meta", { key: "Meta", metaKey: true }],
      ["Win32", "Control", { key: "Control", ctrlKey: true }],
    ])("shows link affordance on %s while %s is held", (platform, _, init) => {
      vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
      const term = new WTerm(element, { autoResize: false });

      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ...init }),
      );
      expect(element.classList.contains("link-modifier-active")).toBe(true);

      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, key: init.key }),
      );
      expect(element.classList.contains("link-modifier-active")).toBe(false);

      term.destroy();
    });

    it("clears link affordance on window blur and destroy", () => {
      vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
      const term = new WTerm(element, { autoResize: false });

      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Meta",
          metaKey: true,
        }),
      );
      window.dispatchEvent(new Event("blur"));
      expect(element.classList.contains("link-modifier-active")).toBe(false);

      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Meta",
          metaKey: true,
        }),
      );
      term.destroy();
      expect(element.classList.contains("link-modifier-active")).toBe(false);

      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Control",
          ctrlKey: true,
        }),
      );
      expect(element.classList.contains("link-modifier-active")).toBe(false);
    });

    it("blocks plain link activation", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      const link = document.createElement("a");
      link.className = "term-link";
      element.querySelector(".term-grid")!.appendChild(link);

      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
      });
      expect(link.dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    });

    it.each([
      ["MacIntel", "Meta", { metaKey: true }],
      ["Win32", "Control", { ctrlKey: true }],
    ])(
      "keeps %s-click available on %s while mouse tracking is active",
      async (platform, _, init) => {
        vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
        vi.mocked(mockBridge.mouseTracking!).mockReturnValue(1002);
        vi.mocked(mockBridge.mouseSgr!).mockReturnValue(true);
        const term = new WTerm(element, { autoResize: false });
        await term.init();
        const link = document.createElement("a");
        link.className = "term-link";
        element.querySelector(".term-grid")!.appendChild(link);

        const event = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ...init,
        });
        expect(link.dispatchEvent(event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
      },
    );

    it.each([
      ["MacIntel", { ctrlKey: true }],
      ["Win32", { metaKey: true }],
    ])("blocks the non-native modifier on %s", async (platform, init) => {
      vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      const link = document.createElement("a");
      link.className = "term-link";
      element.querySelector(".term-grid")!.appendChild(link);

      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
        ...init,
      });
      expect(link.dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    });

    it("keeps keyboard activation available", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      const link = document.createElement("a");
      link.className = "term-link";
      element.querySelector(".term-grid")!.appendChild(link);

      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 0,
      });
      expect(link.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("init", () => {
    it("loads the WASM bridge and initializes it", async () => {
      const term = new WTerm(element);
      await term.init();

      expect(MockedWasmBridge.load).toHaveBeenCalledWith(undefined);
      expect(mockBridge.init).toHaveBeenCalledWith(80, 24);
    });

    it("passes wasmUrl to WasmBridge.load", async () => {
      const term = new WTerm(element, { wasmUrl: "/custom.wasm" });
      await term.init();

      expect(MockedWasmBridge.load).toHaveBeenCalledWith("/custom.wasm");
    });

    it("sets the bridge on the instance", async () => {
      const term = new WTerm(element);
      expect(term.bridge).toBeNull();
      await term.init();
      expect(term.bridge).toBe(mockBridge);
    });

    it("returns this for chaining", async () => {
      const term = new WTerm(element);
      const result = await term.init();
      expect(result).toBe(term);
    });

    it("creates row elements in the container", async () => {
      const term = new WTerm(element);
      await term.init();
      const rows = element.querySelectorAll(".term-row");
      expect(rows.length).toBe(24);
    });

    it("creates a hidden textarea for input", async () => {
      const term = new WTerm(element);
      await term.init();
      const textarea = element.querySelector("textarea");
      expect(textarea).not.toBeNull();
    });

    it("calls destroy and throws on WASM load failure", async () => {
      vi.mocked(MockedWasmBridge.load).mockRejectedValue(
        new Error("fetch failed"),
      );
      const term = new WTerm(element);

      await expect(term.init()).rejects.toThrow(
        "wterm: failed to initialize: fetch failed",
      );
      expect(element.innerHTML).toBe("");
    });

    it("skips setup if destroyed before load resolves", async () => {
      let resolveLoad: (bridge: WasmBridge) => void;
      vi.mocked(MockedWasmBridge.load).mockReturnValue(
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      );

      const term = new WTerm(element);
      const initPromise = term.init();
      term.destroy();
      resolveLoad!(mockBridge);
      await initPromise;

      expect(mockBridge.init).not.toHaveBeenCalled();
    });
  });

  describe("write", () => {
    it("calls bridge.writeString for string data", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      term.write("hello");
      expect(mockBridge.writeString).toHaveBeenCalledWith(
        "hello",
        expect.any(Function),
      );
    });

    it("calls bridge.writeRaw for Uint8Array data", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      const bytes = new Uint8Array([0x1b, 0x5b, 0x41]);
      term.write(bytes);
      expect(mockBridge.writeRaw).toHaveBeenCalledWith(
        bytes,
        expect.any(Function),
      );
    });

    it("is a no-op before init", () => {
      const term = new WTerm(element);
      term.write("hello");
      expect(mockBridge.writeString).not.toHaveBeenCalled();
    });

    it("requests a frame immediately and coalesces writes until it paints", async () => {
      const callbacks: FrameRequestCallback[] = [];
      const requestAnimationFrame = vi
        .spyOn(globalThis, "requestAnimationFrame")
        .mockImplementation((callback) => {
          callbacks.push(callback);
          return callbacks.length;
        });
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      requestAnimationFrame.mockClear();
      callbacks.length = 0;

      term.write("a");
      term.write("b");

      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
      callbacks[0](performance.now());
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(2);
    });
  });

  describe("resize", () => {
    it("updates cols and rows", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      term.resize(120, 40);
      expect(term.cols).toBe(120);
      expect(term.rows).toBe(40);
    });

    it("calls bridge.resize", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      term.resize(120, 40);
      expect(mockBridge.resize).toHaveBeenCalledWith(120, 40);
    });

    it("fires the onResize callback", async () => {
      const onResize = vi.fn();
      const term = new WTerm(element, { autoResize: false, onResize });
      await term.init();
      term.resize(100, 30);
      expect(onResize).toHaveBeenCalledWith(100, 30);
    });

    it("preserves the scroll offset while rebuilding virtualized rows", async () => {
      vi.mocked(mockBridge.getScrollbackCount).mockReturnValue(100);
      vi.mocked(mockBridge.getCols).mockReturnValue(100);
      vi.mocked(mockBridge.getRows).mockReturnValue(30);
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      const originalSetup = Renderer.prototype.setup;
      vi.spyOn(Renderer.prototype, "setup").mockImplementation(
        function (cols, rows) {
          originalSetup.call(this, cols, rows);
          element.scrollTop = 0;
        },
      );
      const render = vi.spyOn(Renderer.prototype, "render");
      Object.defineProperty(element, "clientHeight", {
        configurable: true,
        value: 170,
      });
      Object.defineProperty(element, "scrollHeight", {
        configurable: true,
        value: 2210,
      });

      const term = new WTerm(element, { autoResize: false });
      await term.init();
      (term as unknown as { _rowHeight: number })._rowHeight = 17;
      element.scrollTop = 600;
      render.mockClear();

      term.resize(100, 30);

      expect(render.mock.calls[0][1]?.scrollTop).toBe(600);
      expect(element.scrollTop).toBe(600);
    });

    it("keeps the original scroll offset across coalesced resizes", async () => {
      vi.mocked(mockBridge.getScrollbackCount).mockReturnValue(100);
      vi.mocked(mockBridge.getCols).mockReturnValue(120);
      vi.mocked(mockBridge.getRows).mockReturnValue(40);
      let renderFrame: FrameRequestCallback | undefined;
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        renderFrame = cb;
        return 1;
      });
      const originalSetup = Renderer.prototype.setup;
      vi.spyOn(Renderer.prototype, "setup").mockImplementation(
        function (cols, rows) {
          originalSetup.call(this, cols, rows);
          element.scrollTop = 0;
        },
      );
      const render = vi.spyOn(Renderer.prototype, "render");
      Object.defineProperty(element, "clientHeight", {
        configurable: true,
        value: 170,
      });
      Object.defineProperty(element, "scrollHeight", {
        configurable: true,
        value: 2210,
      });

      const term = new WTerm(element, { autoResize: false });
      await term.init();
      (term as unknown as { _rowHeight: number })._rowHeight = 17;
      element.scrollTop = 600;
      render.mockClear();

      term.resize(100, 30);
      term.resize(120, 40);
      renderFrame?.(performance.now());

      expect(render.mock.calls[0][1]?.scrollTop).toBe(600);
      expect(element.scrollTop).toBe(600);
    });

    it("is a no-op before init", () => {
      const term = new WTerm(element);
      term.resize(120, 40);
      expect(mockBridge.resize).not.toHaveBeenCalled();
    });
  });

  describe("focus", () => {
    it("focuses the internal textarea after init", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      const textarea = element.querySelector("textarea")!;
      const focusSpy = vi.spyOn(textarea, "focus");
      term.focus();
      expect(focusSpy).toHaveBeenCalled();
    });

    it("focuses the element itself before init", () => {
      const term = new WTerm(element);
      const focusSpy = vi.spyOn(element, "focus");
      term.focus();
      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe("onData echo fallback", () => {
    it("echoes input back via write when onData is null", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();

      const textarea = element.querySelector("textarea")!;
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(mockBridge.writeString).toHaveBeenCalledWith(
        "a",
        expect.any(Function),
      );
    });

    it("calls onData instead of write when provided", async () => {
      const onData = vi.fn();
      const term = new WTerm(element, { autoResize: false, onData });
      await term.init();

      const textarea = element.querySelector("textarea")!;
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(onData).toHaveBeenCalledWith("a");
      expect(mockBridge.writeString).not.toHaveBeenCalled();
    });
  });

  describe("onTitle callback", () => {
    it("fires when the bridge reports a title change", async () => {
      const onTitle = vi.fn();
      vi.mocked(mockBridge.getTitle).mockReturnValue("my title");

      const term = new WTerm(element, { autoResize: false, onTitle });
      await term.init();

      expect(onTitle).toHaveBeenCalledWith("my title");
    });

    it("does not fire when title is null", async () => {
      const onTitle = vi.fn();
      vi.mocked(mockBridge.getTitle).mockReturnValue(null);

      const term = new WTerm(element, { autoResize: false, onTitle });
      await term.init();

      expect(onTitle).not.toHaveBeenCalled();
    });
  });

  describe("response forwarding", () => {
    it("forwards every queued bridge response to onData", async () => {
      const onData = vi.fn();
      vi.mocked(mockBridge.getResponse)
        .mockReturnValueOnce("response-a")
        .mockReturnValueOnce("response-b")
        .mockReturnValue(null);

      const term = new WTerm(element, { autoResize: false, onData });
      await term.init();

      onData.mockClear();
      vi.mocked(mockBridge.getResponse)
        .mockReturnValueOnce("response-a")
        .mockReturnValueOnce("response-b")
        .mockReturnValue(null);
      term.write("query");

      expect(onData.mock.calls).toEqual([["response-a"], ["response-b"]]);
    });

    it("finishes parsing and schedules rendering when onData throws", async () => {
      const error = new Error("consumer failed");
      const onData = vi
        .fn<(data: string) => void>()
        .mockImplementationOnce(() => {
          throw error;
        });
      const term = new WTerm(element, {
        autoResize: false,
        onData,
      });
      await term.init();
      const scheduleRender = vi.spyOn(
        term as unknown as { _scheduleRender(): void },
        "_scheduleRender",
      );
      vi.mocked(mockBridge.getResponse).mockClear();
      vi.mocked(mockBridge.writeString).mockImplementation(
        (_data, afterChunk) => {
          vi.mocked(mockBridge.getResponse)
            .mockReturnValueOnce("response-a")
            .mockReturnValueOnce(null);
          afterChunk?.();
          vi.mocked(mockBridge.getResponse)
            .mockReturnValueOnce("response-b")
            .mockReturnValueOnce(null);
          afterChunk?.();
        },
      );

      expect(() => term.write("data")).toThrow(error);
      expect(onData.mock.calls).toEqual([["response-a"], ["response-b"]]);
      expect(mockBridge.getResponse).toHaveBeenCalledTimes(5);
      expect(scheduleRender).toHaveBeenCalledTimes(1);
    });

    it("rethrows undefined from onData after scheduling rendering", async () => {
      const onData = vi.fn(() => {
        throw undefined;
      });
      const term = new WTerm(element, { autoResize: false, onData });
      await term.init();
      const scheduleRender = vi.spyOn(
        term as unknown as { _scheduleRender(): void },
        "_scheduleRender",
      );
      vi.mocked(mockBridge.getResponse)
        .mockReturnValueOnce("response")
        .mockReturnValue(null);

      let completed = false;
      try {
        term.write("query");
        completed = true;
      } catch (error) {
        expect(error).toBeUndefined();
      }

      expect(completed).toBe(false);
      expect(scheduleRender).toHaveBeenCalledTimes(1);
    });
  });

  describe("synchronized output", () => {
    it("holds rendering until synchronized output closes", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      let synchronized = false;
      vi.mocked(mockBridge.synchronizedOutput).mockImplementation(
        () => synchronized,
      );
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();

      synchronized = true;
      term.write("partial");
      await vi.advanceTimersByTimeAsync(20);
      expect(mockBridge.clearDirty).not.toHaveBeenCalled();

      synchronized = false;
      term.write("complete");
      expect(mockBridge.synchronizedOutput).toHaveLastReturnedWith(false);
      expect(
        (term as unknown as { _rendererNeedsSetup: boolean })
          ._rendererNeedsSetup,
      ).toBe(false);
      await vi.runAllTimersAsync();
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("forwards responses while rendering is held", async () => {
      const onData = vi.fn();
      vi.mocked(mockBridge.synchronizedOutput).mockReturnValue(true);
      const term = new WTerm(element, { autoResize: false, onData });
      await term.init();
      onData.mockClear();
      vi.mocked(mockBridge.getResponse)
        .mockReturnValueOnce("response")
        .mockReturnValue(null);

      term.write("query");

      expect(onData).toHaveBeenCalledWith("response");
      term.destroy();
    });

    it("flushes an unterminated synchronized block", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      vi.mocked(mockBridge.synchronizedOutput).mockReturnValue(true);
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();

      term.write("partial");
      await vi.advanceTimersByTimeAsync(999);
      expect(mockBridge.clearDirty).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("keeps painting after an unterminated synchronized block", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });
      vi.mocked(mockBridge.synchronizedOutput).mockReturnValue(true);
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();

      term.write("partial");
      await vi.advanceTimersByTimeAsync(1002);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);

      term.write("more");
      await vi.advanceTimersByTimeAsync(2);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it("does not extend the fallback deadline for ordinary payload", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      vi.mocked(mockBridge.synchronizedOutput).mockReturnValue(true);
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();

      term.write("partial");
      await vi.advanceTimersByTimeAsync(900);
      term.write("continued");
      await vi.advanceTimersByTimeAsync(101);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("holds a fresh synchronized block after recovery", async () => {
      vi.useFakeTimers();
      const frameTimers = new Map<number, ReturnType<typeof setTimeout>>();
      let nextFrameId = 1;
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        const id = nextFrameId++;
        frameTimers.set(
          id,
          setTimeout(() => {
            frameTimers.delete(id);
            cb(performance.now());
          }, 0),
        );
        return id;
      });
      vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
        const timer = frameTimers.get(id);
        if (timer !== undefined) clearTimeout(timer);
        frameTimers.delete(id);
      });
      let synchronized = true;
      vi.mocked(mockBridge.synchronizedOutput).mockImplementation(
        () => synchronized,
      );
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();

      term.write("stalled");
      await vi.advanceTimersByTimeAsync(1001);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);

      synchronized = false;
      term.write("old close");
      synchronized = true;
      term.write("fresh open");
      await vi.advanceTimersByTimeAsync(500);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      synchronized = false;
      term.write("fresh close");
      await vi.runAllTimersAsync();
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it("holds a fresh block when close and reopen share one write", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      let generation = 1;
      vi.mocked(mockBridge.synchronizedOutput).mockReturnValue(true);
      mockBridge.synchronizedOutputGeneration = () => generation;
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();

      term.write("stalled");
      await vi.advanceTimersByTimeAsync(1001);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);

      generation = 2;
      term.write("close and reopen");
      await vi.advanceTimersByTimeAsync(500);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("gives each chained generation a fresh recovery deadline", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      let generation = 1;
      vi.mocked(mockBridge.synchronizedOutput).mockReturnValue(true);
      mockBridge.synchronizedOutputGeneration = () => generation;
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();

      term.write("frame 1");
      await vi.advanceTimersByTimeAsync(600);
      generation++;
      term.write("frame 2");
      await vi.advanceTimersByTimeAsync(999);
      expect(mockBridge.clearDirty).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("commits recovery before a new block can cancel it", async () => {
      vi.useFakeTimers();
      const requestAnimationFrame = vi
        .spyOn(globalThis, "requestAnimationFrame")
        .mockReturnValue(42);
      let generation = 1;
      vi.mocked(mockBridge.synchronizedOutput).mockReturnValue(true);
      mockBridge.synchronizedOutputGeneration = () => generation;
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();
      requestAnimationFrame.mockClear();

      term.write("frame 1");
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      expect(requestAnimationFrame).not.toHaveBeenCalled();

      generation++;
      term.write("frame 2");
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("arms recovery before response delivery", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      vi.mocked(mockBridge.synchronizedOutput).mockReturnValue(true);
      const error = new Error("consumer failed");
      const term = new WTerm(element, {
        autoResize: false,
        onData: () => {
          throw error;
        },
      });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();
      vi.mocked(mockBridge.getResponse)
        .mockReturnValueOnce("response")
        .mockReturnValue(null);

      expect(() => term.write("open")).toThrow(error);
      await vi.advanceTimersByTimeAsync(1001);
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("schedules a closing frame before response delivery", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });
      let synchronized = true;
      vi.mocked(mockBridge.synchronizedOutput).mockImplementation(
        () => synchronized,
      );
      const error = new Error("consumer failed");
      const term = new WTerm(element, {
        autoResize: false,
        onData: () => {
          throw error;
        },
      });
      await term.init();
      vi.mocked(mockBridge.clearDirty).mockClear();
      term.write("open");
      vi.mocked(mockBridge.getResponse)
        .mockReturnValueOnce("response")
        .mockReturnValue(null);
      synchronized = false;

      expect(() => term.write("close")).toThrow(error);
      await vi.runAllTimersAsync();
      expect(mockBridge.clearDirty).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("cancels a queued animation frame when synchronized output starts", async () => {
      vi.useFakeTimers();
      const cancelAnimationFrame = vi.spyOn(globalThis, "cancelAnimationFrame");
      vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(42);
      let synchronized = false;
      vi.mocked(mockBridge.synchronizedOutput).mockImplementation(
        () => synchronized,
      );
      const term = new WTerm(element, { autoResize: false });
      await term.init();

      term.write("normal");
      await vi.advanceTimersByTimeAsync(0);
      synchronized = true;
      term.write("partial");

      expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
      term.destroy();
      vi.useRealTimers();
    });

    it("clears the synchronized output fallback when destroyed", async () => {
      vi.useFakeTimers();
      vi.mocked(mockBridge.synchronizedOutput).mockReturnValue(true);
      const term = new WTerm(element, { autoResize: false });
      await term.init();

      term.write("partial");
      expect(
        (term as unknown as { _synchronizedOutputTimer: unknown })
          ._synchronizedOutputTimer,
      ).not.toBeNull();
      term.destroy();
      expect(
        (term as unknown as { _synchronizedOutputTimer: unknown })
          ._synchronizedOutputTimer,
      ).toBeNull();
      vi.useRealTimers();
    });

    it("does not rebuild rows during a synchronized resize", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      let synchronized = true;
      vi.mocked(mockBridge.synchronizedOutput).mockImplementation(
        () => synchronized,
      );
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      const setup = vi.spyOn(Renderer.prototype, "setup");
      setup.mockClear();

      term.resize(100, 30);
      expect(setup).not.toHaveBeenCalled();

      synchronized = false;
      term.write("complete");
      await vi.runAllTimersAsync();
      expect(setup).toHaveBeenCalledWith(100, 30);
      vi.useRealTimers();
    });
  });

  describe("scrollback class toggle", () => {
    it("adds has-scrollback when scrollback exists", async () => {
      vi.mocked(mockBridge.getScrollbackCount).mockReturnValue(5);

      const term = new WTerm(element, { autoResize: false });
      await term.init();

      expect(element.classList.contains("has-scrollback")).toBe(true);
    });

    it("does not add has-scrollback when scrollback is empty", async () => {
      vi.mocked(mockBridge.getScrollbackCount).mockReturnValue(0);

      const term = new WTerm(element, { autoResize: false });
      await term.init();

      expect(element.classList.contains("has-scrollback")).toBe(false);
    });

    it("scrolls to the exact bottom when output arrives", async () => {
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      Object.defineProperty(element, "clientHeight", {
        configurable: true,
        value: 20,
      });
      Object.defineProperty(element, "scrollHeight", {
        configurable: true,
        value: 73,
      });

      const term = new WTerm(element, { autoResize: false });
      await term.init();
      element.scrollTop = 53;

      term.write("next");

      expect(element.scrollTop).toBe(53);
    });

    it("schedules a render when the scroll position changes", async () => {
      const requestAnimationFrame = vi
        .spyOn(globalThis, "requestAnimationFrame")
        .mockReturnValue(42);
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      requestAnimationFrame.mockClear();

      element.dispatchEvent(new Event("scroll"));

      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
      term.destroy();
    });

    it("keeps the same retained row anchored after old history is discarded", async () => {
      let discarded = 0;
      vi.mocked(mockBridge.getScrollbackCount).mockReturnValue(1000);
      vi.mocked(mockBridge.getScrollbackDiscardedCount!).mockImplementation(
        () => discarded,
      );
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(performance.now());
        return 1;
      });
      Object.defineProperty(element, "clientHeight", {
        configurable: true,
        value: 170,
      });
      Object.defineProperty(element, "scrollHeight", {
        configurable: true,
        value: 17408,
      });

      const term = new WTerm(element, { autoResize: false });
      await term.init();
      (term as unknown as { _rowHeight: number })._rowHeight = 17;
      element.scrollTop = 340;
      discarded = 3;

      term.write("rollover");

      expect(element.scrollTop).toBe(289);
    });
  });

  describe("destroy", () => {
    it("clears element innerHTML", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      expect(element.innerHTML).not.toBe("");
      term.destroy();
      expect(element.innerHTML).toBe("");
    });

    it("removes the input textarea", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      expect(element.querySelector("textarea")).not.toBeNull();
      term.destroy();
      expect(element.querySelector("textarea")).toBeNull();
    });

    it("is safe to call multiple times", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      term.destroy();
      term.destroy();
      expect(element.innerHTML).toBe("");
    });
  });
});
