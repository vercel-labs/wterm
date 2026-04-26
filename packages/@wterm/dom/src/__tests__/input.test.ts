import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InputHandler } from "../input.js";
import type { WasmBridge } from "@wterm/core";

function createKeyboardEvent(
  key: string,
  opts: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
}

describe("InputHandler", () => {
  let container: HTMLElement;
  let received: string[];
  let handler: InputHandler;
  let bridgeMock: WasmBridge | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    received = [];
    bridgeMock = null;

    handler = new InputHandler(
      container,
      (data) => received.push(data),
      () => bridgeMock,
    );
  });

  afterEach(() => {
    handler.destroy();
    container.remove();
  });

  function getTextarea(): HTMLTextAreaElement {
    return container.querySelector("textarea")!;
  }

  describe("setup", () => {
    it("creates a hidden textarea in the container", () => {
      const ta = getTextarea();
      expect(ta).not.toBeNull();
      expect(ta.getAttribute("aria-hidden")).toBe("true");
    });

    it("sets autocomplete off attributes", () => {
      const ta = getTextarea();
      expect(ta.getAttribute("autocomplete")).toBe("off");
      expect(ta.getAttribute("spellcheck")).toBe("false");
    });
  });

  describe("focus", () => {
    it("focuses the textarea", () => {
      const ta = getTextarea();
      const focusSpy = vi.spyOn(ta, "focus");
      handler.focus();
      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe("key mapping - fixed keys", () => {
    it("maps Enter to carriage return", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("Enter"));
      expect(received).toContain("\r");
    });

    it("maps Backspace to DEL", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("Backspace"));
      expect(received).toContain("\x7f");
    });

    it("maps Tab to tab character", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("Tab"));
      expect(received).toContain("\t");
    });

    it("maps Escape key", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("Escape"));
      expect(received).toContain("\x1b");
    });
  });

  describe("key mapping - arrow keys (normal mode)", () => {
    it("maps ArrowUp", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowUp"));
      expect(received).toContain("\x1b[A");
    });

    it("maps ArrowDown", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowDown"));
      expect(received).toContain("\x1b[B");
    });

    it("maps ArrowRight", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowRight"));
      expect(received).toContain("\x1b[C");
    });

    it("maps ArrowLeft", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowLeft"));
      expect(received).toContain("\x1b[D");
    });
  });

  describe("key mapping - arrow keys (application mode)", () => {
    beforeEach(() => {
      bridgeMock = { cursorKeysApp: () => true } as any;
    });

    it("maps ArrowUp to application mode", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowUp"));
      expect(received).toContain("\x1bOA");
    });

    it("maps ArrowDown to application mode", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowDown"));
      expect(received).toContain("\x1bOB");
    });
  });

  describe("key mapping - ctrl sequences", () => {
    it("maps Ctrl+A to SOH", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("a", { ctrlKey: true }));
      expect(received).toContain("\x01");
    });

    it("maps Ctrl+C to ETX", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("c", { ctrlKey: true }));
      expect(received).toContain("\x03");
    });

    it("maps Ctrl+Z to SUB", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("z", { ctrlKey: true }));
      expect(received).toContain("\x1a");
    });
  });

  describe("key mapping - alt modifier", () => {
    it("prepends ESC for Alt+letter", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("b", { altKey: true }));
      expect(received).toContain("\x1bb");
    });

    it("prepends ESC for Alt+Enter", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("Enter", { altKey: true }));
      expect(received).toContain("\x1b\r");
    });
  });

  describe("key mapping - shift combinations", () => {
    it("maps Shift+Enter to CSI 13;2u", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("Enter", { shiftKey: true }));
      expect(received).toContain("\x1b[13;2u");
    });

    it("maps Shift+Tab to reverse tab", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("Tab", { shiftKey: true }));
      expect(received).toContain("\x1b[Z");
    });
  });

  describe("printable characters", () => {
    it("sends single printable characters", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("x"));
      expect(received).toContain("x");
    });
  });

  describe("paste", () => {
    it("sends pasted text as-is without bracketed paste", () => {
      const ta = getTextarea();
      const pasteEvent = new Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as any;
      pasteEvent.clipboardData = { getData: () => "pasted text" };
      ta.dispatchEvent(pasteEvent);
      expect(received).toContain("pasted text");
    });

    it("wraps pasted text in bracketed paste sequences", () => {
      bridgeMock = { bracketedPaste: () => true } as any;
      const ta = getTextarea();
      const pasteEvent = new Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as any;
      pasteEvent.clipboardData = { getData: () => "hello" };
      ta.dispatchEvent(pasteEvent);
      expect(received).toContain("\x1b[200~hello\x1b[201~");
    });

    it("strips ESC bytes from bracketed paste to prevent injection", () => {
      bridgeMock = { bracketedPaste: () => true } as any;
      const ta = getTextarea();
      const pasteEvent = new Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as any;
      // Payload tries to escape bracketed paste mode and inject a command.
      pasteEvent.clipboardData = {
        getData: () => "safe\x1b[201~rm -rf /\r",
      };
      ta.dispatchEvent(pasteEvent);
      expect(received.join("")).toBe("\x1b[200~safe[201~rm -rf /\r\x1b[201~");
      expect(received.join("")).not.toContain("\x1b[201~rm");
    });
  });

  describe("IME composition - keydown gating", () => {
    it("ignores keydown events whose keyCode is 229 (IME first keystroke)", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("Process", { keyCode: 229 }));
      expect(received).toHaveLength(0);
    });

    it("ignores keydown events flagged as isComposing", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("a", { isComposing: true }));
      expect(received).toHaveLength(0);
    });

    it("ignores ordinary keydown while composing", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      ta.dispatchEvent(createKeyboardEvent("a"));
      expect(received).toHaveLength(0);
    });
  });

  describe("IME composition - overlay", () => {
    function getCompositionView(): HTMLSpanElement {
      return container.querySelector(".term-composition") as HTMLSpanElement;
    }

    it("creates a hidden composition overlay alongside the textarea", () => {
      const view = getCompositionView();
      expect(view).not.toBeNull();
      expect(view.style.display).toBe("none");
    });

    it("shows the composition overlay on compositionstart", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      expect(getCompositionView().style.display).toBe("inline-block");
    });

    it("renders uncommitted text into the overlay on compositionupdate", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      ta.dispatchEvent(
        new CompositionEvent("compositionupdate", { data: "こん" }),
      );
      expect(getCompositionView().textContent).toBe("こん");
      ta.dispatchEvent(
        new CompositionEvent("compositionupdate", { data: "こんにちは" }),
      );
      expect(getCompositionView().textContent).toBe("こんにちは");
    });

    it("does not send uncommitted text to onData while composing", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      ta.dispatchEvent(
        new CompositionEvent("compositionupdate", { data: "こんにちは" }),
      );
      expect(received).toHaveLength(0);
    });

    it("commits final text and hides the overlay on compositionend", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      ta.dispatchEvent(
        new CompositionEvent("compositionupdate", { data: "こんにちは" }),
      );
      ta.dispatchEvent(
        new CompositionEvent("compositionend", { data: "こんにちは" }),
      );
      expect(received).toContain("こんにちは");
      expect(getCompositionView().style.display).toBe("none");
      expect(getCompositionView().textContent).toBe("");
    });

    it("emits no data when composition ends with empty data", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      ta.dispatchEvent(new CompositionEvent("compositionend", { data: "" }));
      expect(received).toHaveLength(0);
    });
  });

  describe("destroy", () => {
    it("removes textarea from DOM", () => {
      handler.destroy();
      expect(container.querySelector("textarea")).toBeNull();
    });

    it("removes the composition overlay from DOM", () => {
      handler.destroy();
      expect(container.querySelector(".term-composition")).toBeNull();
    });

    it("removes focused class", () => {
      container.classList.add("focused");
      handler.destroy();
      expect(container.classList.contains("focused")).toBe(false);
    });

    it("stops responding to key events", () => {
      handler.destroy();
      const ta = document.createElement("textarea");
      container.appendChild(ta);
      ta.dispatchEvent(createKeyboardEvent("a"));
      expect(received).toHaveLength(0);
    });
  });
});
