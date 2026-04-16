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
      expect(mockBridge.writeString).toHaveBeenCalledWith("hello");
    });

    it("calls bridge.writeRaw for Uint8Array data", async () => {
      const term = new WTerm(element, { autoResize: false });
      await term.init();
      const bytes = new Uint8Array([0x1b, 0x5b, 0x41]);
      term.write(bytes);
      expect(mockBridge.writeRaw).toHaveBeenCalledWith(bytes);
    });

    it("is a no-op before init", () => {
      const term = new WTerm(element);
      term.write("hello");
      expect(mockBridge.writeString).not.toHaveBeenCalled();
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

      expect(mockBridge.writeString).toHaveBeenCalledWith("a");
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
    it("forwards bridge response to onData", async () => {
      const onData = vi.fn();
      vi.mocked(mockBridge.getResponse).mockReturnValue("response-data");

      const term = new WTerm(element, { autoResize: false, onData });
      await term.init();

      expect(onData).toHaveBeenCalledWith("response-data");
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
