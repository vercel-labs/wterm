import type { WasmBridge } from "@wterm/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputHandler } from "../input.js";

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

function createKeyUpEvent(
  key: string,
  opts: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent("keyup", {
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

  describe("Kitty keyboard protocol", () => {
    it("uses the negotiated flags for press, repeat, and release", () => {
      bridgeMock = { kittyKeyboardFlags: () => 31 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("a", { code: "KeyA", repeat: true }),
      );
      ta.dispatchEvent(createKeyUpEvent("a", { code: "KeyA" }));
      expect(received).toEqual(["\x1b[97;1:2;97u", "\x1b[97;1:3u"]);
    });

    it("does not emit a release for plain text without report-all", () => {
      bridgeMock = { kittyKeyboardFlags: () => 2 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("a", { code: "KeyA" }));
      ta.dispatchEvent(createKeyUpEvent("a", { code: "KeyA" }));
      expect(received).toEqual(["a"]);
    });

    it("keeps shifted text plain when only report-alternates is active", () => {
      bridgeMock = { kittyKeyboardFlags: () => 4 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("A", { code: "KeyA", shiftKey: true }),
      );
      ta.dispatchEvent(createKeyUpEvent("A", { code: "KeyA", shiftKey: true }));
      expect(received).toEqual(["A"]);
    });

    it("keeps Ctrl+A legacy when only report-alternates is active", () => {
      bridgeMock = { kittyKeyboardFlags: () => 4 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("a", { code: "KeyA", ctrlKey: true }),
      );
      ta.dispatchEvent(createKeyUpEvent("a", { code: "KeyA", ctrlKey: true }));
      expect(received).toEqual(["\x01"]);
    });

    it("preserves functional bytes under isolated enhancement flags", () => {
      const ta = getTextarea();
      for (const flags of [2, 4]) {
        bridgeMock = {
          kittyKeyboardFlags: () => flags,
          cursorKeysApp: () => false,
        } as any;
        ta.dispatchEvent(createKeyboardEvent("Escape", { code: "Escape" }));
        ta.dispatchEvent(createKeyboardEvent("Enter", { code: "NumpadEnter" }));
      }
      bridgeMock = {
        kittyKeyboardFlags: () => 4,
        cursorKeysApp: () => false,
      } as any;
      ta.dispatchEvent(createKeyboardEvent("F1", { code: "F1" }));
      ta.dispatchEvent(
        createKeyboardEvent("Tab", { code: "Tab", shiftKey: true }),
      );
      ta.dispatchEvent(createKeyboardEvent("ArrowUp", { code: "Numpad8" }));
      expect(received).toEqual([
        "\x1b",
        "\r",
        "\x1b",
        "\r",
        "\x1bOP",
        "\x1b[Z",
        "\x1b[A",
      ]);
    });

    it("uses current cursor application mode in the Kitty legacy window", () => {
      let appMode = false;
      bridgeMock = {
        kittyKeyboardFlags: () => 4,
        cursorKeysApp: () => appMode,
      } as any;
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowUp", { code: "ArrowUp" }));
      appMode = true;
      ta.dispatchEvent(createKeyboardEvent("ArrowUp", { code: "ArrowUp" }));
      expect(received).toEqual(["\x1b[A", "\x1bOA"]);
    });

    it("omits press actions but retains repeat and release actions", () => {
      bridgeMock = {
        kittyKeyboardFlags: () => 2,
        cursorKeysApp: () => false,
      } as any;
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowUp", { code: "ArrowUp" }));
      ta.dispatchEvent(
        createKeyboardEvent("ArrowUp", {
          code: "ArrowUp",
          repeat: true,
        }),
      );
      ta.dispatchEvent(createKeyUpEvent("ArrowUp", { code: "ArrowUp" }));
      expect(received).toEqual(["\x1b[A", "\x1b[1;1:2A", "\x1b[1;1:3A"]);
    });

    it("reports post-release modifier state and preserves a held peer", () => {
      bridgeMock = { kittyKeyboardFlags: () => 1 | 2 | 8 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("Control", {
          code: "ControlLeft",
          ctrlKey: true,
        }),
      );
      ta.dispatchEvent(
        createKeyboardEvent("Control", {
          code: "ControlRight",
          ctrlKey: true,
        }),
      );
      ta.dispatchEvent(
        createKeyUpEvent("Control", {
          code: "ControlLeft",
          ctrlKey: false,
        }),
      );
      ta.dispatchEvent(
        createKeyUpEvent("Control", {
          code: "ControlRight",
          ctrlKey: false,
        }),
      );
      expect(received).toEqual([
        "\x1b[57442;5u",
        "\x1b[57448;5u",
        "\x1b[57442;5:3u",
        "\x1b[57448;1:3u",
      ]);
    });

    it("reports Meta modifiers and releases a delivered key while Meta is held", () => {
      bridgeMock = { kittyKeyboardFlags: () => 1 | 2 | 8 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("Meta", { code: "MetaLeft", metaKey: true }),
      );
      ta.dispatchEvent(
        createKeyUpEvent("Meta", { code: "MetaLeft", metaKey: false }),
      );
      expect(received).toEqual(["\x1b[57444;9u", "\x1b[57444;1:3u"]);

      received.length = 0;
      ta.dispatchEvent(createKeyboardEvent("a", { code: "KeyA" }));
      ta.dispatchEvent(
        createKeyboardEvent("Meta", { code: "MetaLeft", metaKey: true }),
      );
      ta.dispatchEvent(
        createKeyboardEvent("a", {
          code: "KeyA",
          metaKey: true,
          repeat: true,
        }),
      );
      ta.dispatchEvent(createKeyUpEvent("a", { code: "KeyA", metaKey: true }));
      ta.dispatchEvent(
        createKeyUpEvent("Meta", { code: "MetaLeft", metaKey: false }),
      );
      expect(received).toEqual([
        "\x1b[97u",
        "\x1b[57444;9u",
        "\x1b[97;9:2u",
        "\x1b[97;9:3u",
        "\x1b[57444;1:3u",
      ]);
    });

    it("clears tracked modifiers on blur", () => {
      bridgeMock = { kittyKeyboardFlags: () => 1 | 2 | 8 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("Control", {
          code: "ControlRight",
          ctrlKey: true,
        }),
      );
      ta.dispatchEvent(new FocusEvent("blur"));
      ta.dispatchEvent(
        createKeyUpEvent("Control", {
          code: "ControlLeft",
          ctrlKey: false,
        }),
      );
      expect(received.at(-1)).toBe("\x1b[57442;1:3u");
    });

    it("keeps the legacy path for a core without Kitty support", () => {
      bridgeMock = { cursorKeysApp: () => false } as any;
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowUp"));
      ta.dispatchEvent(createKeyUpEvent("ArrowUp"));
      expect(received).toEqual(["\x1b[A"]);
    });

    it("does not emit a release for a browser-owned shortcut", () => {
      bridgeMock = { kittyKeyboardFlags: () => 31 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("v", {
          code: "KeyV",
          metaKey: true,
        }),
      );
      ta.dispatchEvent(createKeyUpEvent("v", { code: "KeyV" }));
      expect(received).toEqual([]);
    });

    it("does not emit a release after a composing keydown", () => {
      bridgeMock = { kittyKeyboardFlags: () => 31 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart"));
      ta.dispatchEvent(createKeyboardEvent("Dead", { code: "Quote" }));
      ta.dispatchEvent(new CompositionEvent("compositionend", { data: "é" }));
      ta.dispatchEvent(createKeyUpEvent("Dead", { code: "Quote" }));
      expect(received).toEqual(["é"]);
    });

    it("clears a stale shortcut suppression on the next real keydown", () => {
      bridgeMock = { kittyKeyboardFlags: () => 31 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("v", {
          code: "KeyV",
          metaKey: true,
        }),
      );
      ta.dispatchEvent(createKeyboardEvent("v", { code: "KeyV" }));
      ta.dispatchEvent(createKeyUpEvent("v", { code: "KeyV" }));
      expect(received).toEqual(["\x1b[118;;118u", "\x1b[118;1:3u"]);
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

  describe("destroy", () => {
    it("removes textarea from DOM", () => {
      handler.destroy();
      expect(container.querySelector("textarea")).toBeNull();
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
