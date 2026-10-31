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

function markAltGraph(event: KeyboardEvent): KeyboardEvent {
  Object.defineProperty(event, "getModifierState", {
    value: (modifier: string) => modifier === "AltGraph",
  });
  return event;
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

  describe("full-history selection shortcuts", () => {
    it.each([0, 31])(
      "owns Select All/Copy/Escape with Kitty flags %i",
      (flags) => {
        handler.destroy();
        bridgeMock = { kittyKeyboardFlags: () => flags } as any;
        let active = false;
        const actions = {
          selectAll: vi.fn(() => {
            active = true;
          }),
          hasSelection: () => active,
          clearSelection: vi.fn(() => {
            active = false;
          }),
        };
        handler = new InputHandler(
          container,
          (data) => received.push(data),
          () => bridgeMock,
          undefined,
          undefined,
          undefined,
          actions,
        );
        const ta = getTextarea();
        for (const modifiers of [
          { metaKey: true },
          { ctrlKey: true, shiftKey: true },
        ]) {
          const event = createKeyboardEvent("a", {
            code: "KeyA",
            ...modifiers,
          });
          ta.dispatchEvent(event);
          ta.dispatchEvent(
            createKeyUpEvent("a", { code: "KeyA", ...modifiers }),
          );
          expect(event.defaultPrevented).toBe(true);
          expect(active).toBe(true);
        }
        const copy = createKeyboardEvent("c", { code: "KeyC", metaKey: true });
        ta.dispatchEvent(copy);
        ta.dispatchEvent(
          createKeyUpEvent("c", { code: "KeyC", metaKey: true }),
        );
        expect(copy.defaultPrevented).toBe(false);
        expect(received).toEqual([]);
        ta.dispatchEvent(createKeyboardEvent("Escape", { code: "Escape" }));
        ta.dispatchEvent(createKeyUpEvent("Escape", { code: "Escape" }));
        expect(active).toBe(false);
        expect(received).toEqual([]);
        ta.dispatchEvent(
          createKeyboardEvent("a", { code: "KeyA", ctrlKey: true }),
        );
        expect(received).toEqual([flags ? "\x1b[97;5u" : "\x01"]);
        expect(actions.selectAll).toHaveBeenCalledTimes(2);
      },
    );

    it("retains selection for reported modifiers and leaves AltGr/composition to input", () => {
      handler.destroy();
      bridgeMock = { kittyKeyboardFlags: () => 31 } as any;
      const actions = {
        selectAll: vi.fn(),
        hasSelection: () => true,
        clearSelection: vi.fn(),
      };
      handler = new InputHandler(
        container,
        (data) => received.push(data),
        () => bridgeMock,
        undefined,
        undefined,
        undefined,
        actions,
      );
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("Meta", { code: "MetaLeft", metaKey: true }),
      );
      ta.dispatchEvent(createKeyUpEvent("Meta", { code: "MetaLeft" }));
      expect(actions.clearSelection).not.toHaveBeenCalled();
      ta.dispatchEvent(
        markAltGraph(
          createKeyboardEvent("a", {
            code: "KeyA",
            ctrlKey: true,
            altKey: true,
            shiftKey: true,
          }),
        ),
      );
      ta.dispatchEvent(
        createKeyboardEvent("a", {
          code: "KeyA",
          metaKey: true,
          isComposing: true,
        }),
      );
      expect(actions.selectAll).not.toHaveBeenCalled();
      ta.dispatchEvent(createKeyboardEvent("x", { code: "KeyX" }));
      expect(actions.clearSelection).toHaveBeenCalledOnce();
    });
  });

  describe("setup", () => {
    it("creates a named textarea exposed to assistive technology", () => {
      const ta = getTextarea();
      expect(ta).not.toBeNull();
      expect(ta.hasAttribute("aria-hidden")).toBe(false);
      expect(ta.getAttribute("aria-label")).toBe("Terminal");
    });

    it("sets autocomplete off attributes", () => {
      const ta = getTextarea();
      expect(ta.getAttribute("autocomplete")).toBe("off");
      expect(ta.getAttribute("spellcheck")).toBe("false");
    });

    it("keeps the input on-screen when focused", () => {
      const ta = getTextarea();
      handler.focus();
      expect(ta.style.left).toBe("0px");
      expect(ta.style.top).toBe("0px");
      expect(ta.style.opacity).toBe("0");
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

  describe("IME composition", () => {
    it("shows tentative text at the input without forwarding it", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart"));
      ta.value = "にほんご";
      ta.dispatchEvent(
        new InputEvent("input", {
          data: "にほんご",
          inputType: "insertCompositionText",
        }),
      );

      expect(ta.style.opacity).toBe("1");
      expect(ta.value).toBe("にほんご");
      expect(received).toEqual([]);

      ta.dispatchEvent(
        new CompositionEvent("compositionend", { data: "日本語" }),
      );
      expect(ta.style.opacity).toBe("0");
      expect(ta.value).toBe("");
      expect(received).toEqual(["日本語"]);
    });

    it("ignores an extra input event for the committed text", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart"));
      ta.dispatchEvent(
        new CompositionEvent("compositionend", { data: "中文" }),
      );
      ta.value = "中文";
      ta.dispatchEvent(
        new InputEvent("input", {
          data: "中文",
          inputType: "insertText",
        }),
      );
      expect(received).toEqual(["中文"]);
      expect(ta.value).toBe("");

      ta.value = "next";
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertText" }));
      expect(received).toEqual(["中文", "next"]);
    });

    it("accepts a commit supplied only by the following input event", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart"));
      ta.dispatchEvent(new CompositionEvent("compositionend"));
      ta.value = "中文";
      ta.dispatchEvent(
        new InputEvent("input", {
          data: "中文",
          inputType: "insertFromComposition",
        }),
      );
      expect(received).toEqual(["中文"]);
    });

    it("ignores a duplicate commit when inputType is unavailable", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart"));
      ta.dispatchEvent(
        new CompositionEvent("compositionend", { data: "中文" }),
      );
      ta.value = "中文";
      ta.dispatchEvent(new Event("input"));
      expect(received).toEqual(["中文"]);
    });

    it("accepts repeated text after another keydown", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart"));
      ta.dispatchEvent(new CompositionEvent("compositionend", { data: "a" }));
      ta.dispatchEvent(createKeyboardEvent("Shift", { code: "ShiftLeft" }));
      ta.value = "a";
      ta.dispatchEvent(
        new InputEvent("input", { data: "a", inputType: "insertText" }),
      );
      expect(received).toEqual(["a", "a"]);
    });

    it("clears tentative text when focus leaves the terminal", () => {
      const ta = getTextarea();
      ta.dispatchEvent(new CompositionEvent("compositionstart"));
      ta.value = "にほんご";
      ta.dispatchEvent(new FocusEvent("blur"));
      expect(ta.style.opacity).toBe("0");
      expect(ta.value).toBe("");
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

  describe("key mapping - modified functional keys", () => {
    it.each([
      ["ArrowLeft", { ctrlKey: true }, "\x1b[1;5D"],
      ["ArrowRight", { altKey: true }, "\x1b[1;3C"],
      ["ArrowUp", { shiftKey: true, ctrlKey: true }, "\x1b[1;6A"],
      ["Home", { shiftKey: true }, "\x1b[1;2H"],
      ["End", { altKey: true, ctrlKey: true }, "\x1b[1;7F"],
      ["F1", { shiftKey: true }, "\x1b[1;2P"],
      ["F4", { ctrlKey: true }, "\x1b[1;5S"],
      ["Insert", { shiftKey: true }, "\x1b[2;2~"],
      ["Delete", { ctrlKey: true }, "\x1b[3;5~"],
      ["PageUp", { shiftKey: true }, "\x1b[5;2~"],
      ["PageDown", { altKey: true }, "\x1b[6;3~"],
      ["F5", { shiftKey: true }, "\x1b[15;2~"],
      ["F12", { altKey: true, ctrlKey: true }, "\x1b[24;7~"],
    ] as const)("reports modifiers for %s", (key, modifiers, expected) => {
      const event = createKeyboardEvent(key, modifiers);
      getTextarea().dispatchEvent(event);
      expect(received).toEqual([expected]);
      expect(event.defaultPrevented).toBe(true);
    });

    it("reports modified arrows in application cursor mode", () => {
      bridgeMock = { cursorKeysApp: () => true } as any;
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("ArrowUp"));
      ta.dispatchEvent(createKeyboardEvent("ArrowUp", { ctrlKey: true }));
      expect(received).toEqual(["\x1bOA", "\x1b[1;5A"]);
    });
  });

  describe("key mapping - ctrl sequences", () => {
    it("keeps handled terminal shortcuts from reaching page listeners", () => {
      const pageKeydown = vi.fn();
      document.addEventListener("keydown", pageKeydown);
      try {
        const handled = createKeyboardEvent("k", { ctrlKey: true });
        getTextarea().dispatchEvent(handled);
        expect(received).toEqual(["\x0b"]);
        expect(handled.defaultPrevented).toBe(true);
        expect(pageKeydown).not.toHaveBeenCalled();

        getTextarea().dispatchEvent(createKeyboardEvent("Unidentified"));
        expect(pageKeydown).toHaveBeenCalledOnce();
      } finally {
        document.removeEventListener("keydown", pageKeydown);
      }
    });

    it.each([
      ["Backspace", { altKey: true }, "\x1b\x7f"],
      ["w", { ctrlKey: true }, "\x17"],
      ["k", { ctrlKey: true }, "\x0b"],
      ["u", { ctrlKey: true }, "\x15"],
      ["y", { ctrlKey: true }, "\x19"],
      ["r", { ctrlKey: true }, "\x12"],
      ["s", { ctrlKey: true }, "\x13"],
      ["g", { ctrlKey: true }, "\x07"],
    ] as const)(
      "sends the shell editing shortcut for %s",
      (key, modifiers, expected) => {
        const event = createKeyboardEvent(key, modifiers);
        getTextarea().dispatchEvent(event);
        expect(received).toEqual([expected]);
        expect(event.defaultPrevented).toBe(true);
      },
    );

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

    it.each([
      [" ", {}, "\0"],
      ["2", {}, "\0"],
      ["/", {}, "\x1f"],
      ["?", { shiftKey: true }, "\x7f"],
      ["Backspace", {}, "\x08"],
    ] as const)(
      "maps Ctrl+%s to a control byte",
      (key, modifiers, expected) => {
        const event = createKeyboardEvent(key, { ctrlKey: true, ...modifiers });
        getTextarea().dispatchEvent(event);
        expect(received).toEqual([expected]);
        expect(event.defaultPrevented).toBe(true);
      },
    );

    it("lets Control+Alt printable input reach the native text event", () => {
      const ta = getTextarea();
      const keydown = createKeyboardEvent("@", {
        ctrlKey: true,
        altKey: true,
      });
      ta.dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(false);
      expect(received).toEqual([]);

      ta.value = "@";
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertText" }));
      expect(received).toEqual(["@"]);
    });

    it("lets browser-identified AltGr text bypass the legacy Alt prefix", () => {
      const ta = getTextarea();
      const keydown = markAltGraph(
        createKeyboardEvent("€", { code: "KeyE", altKey: true }),
      );
      ta.dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(false);
      ta.value = "€";
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertText" }));
      expect(received).toEqual(["€"]);
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

    it("lets unmapped keys reach the native input event", () => {
      const ta = getTextarea();
      const keydown = createKeyboardEvent("Unidentified");
      ta.dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(false);

      ta.value = "字";
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertText" }));
      expect(received).toEqual(["字"]);
    });
  });

  describe("Kitty keyboard protocol", () => {
    it.each([1, 1 | 2 | 8 | 16])(
      "accepts native AltGr text with Kitty flags %i without a stray release",
      (flags) => {
        bridgeMock = { kittyKeyboardFlags: () => flags } as any;
        const ta = getTextarea();
        const keydown = markAltGraph(
          createKeyboardEvent("@", {
            code: "KeyQ",
            ctrlKey: true,
            altKey: true,
          }),
        );
        ta.dispatchEvent(keydown);
        expect(keydown.defaultPrevented).toBe(false);
        expect(received).toEqual([]);

        ta.value = "@";
        ta.dispatchEvent(new InputEvent("input", { inputType: "insertText" }));
        ta.dispatchEvent(
          markAltGraph(
            createKeyboardEvent("@", {
              code: "KeyQ",
              ctrlKey: true,
              altKey: true,
              repeat: true,
            }),
          ),
        );
        ta.dispatchEvent(
          markAltGraph(
            createKeyUpEvent("@", {
              code: "KeyQ",
              ctrlKey: true,
              altKey: true,
            }),
          ),
        );
        expect(received).toEqual(["@"]);
      },
    );

    it("does not mistake AltGr text for copy or paste shortcuts", () => {
      bridgeMock = { kittyKeyboardFlags: () => 31 } as any;
      const ta = getTextarea();
      const selected = document.createElement("span");
      selected.textContent = "selected";
      container.append(selected);
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(selected);
      selection.removeAllRanges();
      selection.addRange(range);
      for (const [key, code] of [
        ["c", "KeyC"],
        ["v", "KeyV"],
      ]) {
        const keydown = markAltGraph(
          createKeyboardEvent(key, { code, ctrlKey: true, altKey: true }),
        );
        ta.dispatchEvent(keydown);
        expect(keydown.defaultPrevented).toBe(false);
        ta.value = key;
        ta.dispatchEvent(new InputEvent("input", { inputType: "insertText" }));
        ta.dispatchEvent(
          markAltGraph(
            createKeyUpEvent(key, { code, ctrlKey: true, altKey: true }),
          ),
        );
      }
      expect(received).toEqual(["c", "v"]);
      selection.removeAllRanges();
    });

    it("accepts right Alt text when the browser omits AltGraph state", () => {
      bridgeMock = { kittyKeyboardFlags: () => 31 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("Alt", { code: "AltRight", altKey: true }),
      );
      const keydown = createKeyboardEvent("€", {
        code: "KeyE",
        ctrlKey: true,
        altKey: true,
      });
      ta.dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(false);
      ta.value = "€";
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertText" }));
      ta.dispatchEvent(
        createKeyUpEvent("€", {
          code: "KeyE",
          ctrlKey: true,
          altKey: true,
        }),
      );
      expect(received).toEqual(["\x1b[57449;3u", "€"]);
    });

    it("still encodes functional keys while AltGraph is active", () => {
      bridgeMock = { kittyKeyboardFlags: () => 31 } as any;
      const keydown = markAltGraph(
        createKeyboardEvent("ArrowLeft", {
          code: "ArrowLeft",
          ctrlKey: true,
          altKey: true,
        }),
      );
      getTextarea().dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(true);
      expect(received).toEqual(["\x1b[1;7D"]);
    });

    it("still encodes an actual Control+Alt printable shortcut", () => {
      bridgeMock = { kittyKeyboardFlags: () => 1 | 2 | 8 } as any;
      const keydown = createKeyboardEvent("q", {
        code: "KeyQ",
        ctrlKey: true,
        altKey: true,
      });
      getTextarea().dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(true);
      expect(received).toEqual(["\x1b[113;7u"]);
    });

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
      expect(received).toEqual(["\x1b[57448;5u"]);
      ta.dispatchEvent(createKeyboardEvent("a", { code: "KeyA" }));
      expect(received.at(-1)).toBe("\x1b[97u");
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

    it("ignores the first keydown signaled as composing", () => {
      const ta = getTextarea();
      ta.dispatchEvent(createKeyboardEvent("s", { isComposing: true }));
      ta.dispatchEvent(new CompositionEvent("compositionend", { data: "你" }));
      expect(received).toEqual(["你"]);
    });

    it("ignores the legacy IME processing keydown", () => {
      bridgeMock = { kittyKeyboardFlags: () => 31 } as any;
      const ta = getTextarea();
      ta.dispatchEvent(
        createKeyboardEvent("s", { code: "KeyS", keyCode: 229 }),
      );
      ta.dispatchEvent(createKeyUpEvent("s", { code: "KeyS" }));
      ta.dispatchEvent(new CompositionEvent("compositionend", { data: "好" }));
      expect(received).toEqual(["好"]);
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
