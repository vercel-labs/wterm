import type { TerminalCore } from "@wterm/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputHandler } from "../input.js";

describe.each([0, 31])("keyboard focus exit with Kitty flags %i", (flags) => {
  let host: HTMLElement;
  let input: HTMLTextAreaElement;
  let handler: InputHandler;
  let received: string[];

  function key(
    type: "keydown" | "keyup",
    key: string,
    opts: KeyboardEventInit = {},
  ) {
    const event = new KeyboardEvent(type, {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
    input.dispatchEvent(event);
    return event;
  }
  function press(name: string, opts: KeyboardEventInit = {}) {
    const down = key("keydown", name, opts);
    key("keyup", name, opts);
    return down;
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    received = [];
    handler = new InputHandler(
      host,
      (data) => received.push(data),
      () =>
        ({
          kittyKeyboardFlags: () => flags,
          cursorKeysApp: () => false,
        }) as TerminalCore,
    );
    input = host.querySelector("textarea")!;
    handler.focus();
  });
  afterEach(() => {
    handler.destroy();
    host.remove();
  });

  it.each([false, true])(
    "lets the browser own one Tab after Escape (backward: %s)",
    (shiftKey) => {
      expect(press("Escape").defaultPrevented).toBe(true);
      expect(received).toEqual(flags ? ["\x1b[27u", "\x1b[27;1:3u"] : ["\x1b"]);
      if (shiftKey) key("keydown", "Shift", { code: "ShiftLeft", shiftKey });
      const beforeTab = [...received];
      expect(press("Tab", { shiftKey }).defaultPrevented).toBe(false);
      expect(received).toEqual(beforeTab);
      // A host can cancel native traversal; it must not leave Tab unlocked.
      expect(press("Tab", { shiftKey }).defaultPrevented).toBe(true);
      expect(received.length).toBeGreaterThan(beforeTab.length);
    },
  );

  it.each([
    "typing",
    "Control",
    "Alt",
    "Meta",
    "composition",
    "composing key",
    "IME key code",
    "paste",
    "input",
    "pointer",
    "blur",
  ])("cancels an armed exit on %s", (action) => {
    press("Escape");
    switch (action) {
      case "typing":
        press("a", { code: "KeyA" });
        break;
      case "Control":
        press("Control", { code: "ControlLeft", ctrlKey: true });
        break;
      case "Alt":
        press("Alt", { code: "AltLeft", altKey: true });
        break;
      case "Meta":
        press("Meta", { code: "MetaLeft", metaKey: true });
        break;
      case "composition":
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        input.dispatchEvent(new CompositionEvent("compositionend"));
        break;
      case "composing key":
        press("Escape", { isComposing: true });
        break;
      case "IME key code":
        press("Escape", { keyCode: 229 });
        break;
      case "paste":
        input.dispatchEvent(new Event("paste"));
        break;
      case "input":
        input.dispatchEvent(new InputEvent("input"));
        break;
      case "pointer":
        host.dispatchEvent(new MouseEvent("mousedown"));
        break;
      case "blur":
        input.blur();
        handler.focus();
        break;
    }
    received.length = 0;
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(received[0]).toBe(flags ? "\x1b[9u" : "\t");
  });

  it.each([
    { shiftKey: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
  ])("does not arm on modified Escape: %j", (opts) => {
    press("Escape", opts);
    expect(press("Tab").defaultPrevented).toBe(true);
  });

  it("does not steal a held Tab or its release", () => {
    key("keydown", "Tab");
    press("Escape");
    received.length = 0;
    expect(key("keydown", "Tab", { repeat: true }).defaultPrevented).toBe(true);
    key("keyup", "Tab");
    expect(received).toEqual(flags ? ["\x1b[9;1:2u", "\x1b[9;1:3u"] : ["\t"]);
  });

  it("does not report releases from keys pressed before focus arrived", () => {
    key("keyup", "Tab");
    key("keyup", "Shift", { code: "ShiftLeft" });
    key("keyup", "Escape");
    expect(received).toEqual([]);
    expect(press("Tab").defaultPrevented).toBe(true);
  });
});
