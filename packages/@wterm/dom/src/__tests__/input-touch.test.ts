import type { TerminalCore } from "@wterm/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputHandler } from "../input.js";

describe("touch input", () => {
  let container: HTMLElement;
  let textarea: HTMLTextAreaElement;
  let handler: InputHandler;
  let received: string[];
  let bridge: TerminalCore | null;
  let matchMediaDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    matchMediaDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "matchMedia",
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({ matches: query === "(pointer: coarse)" }),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    received = [];
    bridge = null;
    handler = new InputHandler(
      container,
      (data) => received.push(data),
      () => bridge,
      () => ({ charWidth: 8, rowHeight: 17 }),
    );
    textarea = container.querySelector("textarea")!;
    handler.focus();
  });

  afterEach(() => {
    handler.destroy();
    container.remove();
    if (matchMediaDescriptor) {
      Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  function deleteInput(): void {
    textarea.value = "";
    textarea.dispatchEvent(
      new InputEvent("input", { inputType: "deleteContentBackward" }),
    );
  }

  it("keeps a touchable input target at the cursor", () => {
    expect(textarea.style.left).toBe("0px");
    expect(textarea.style.opacity).toBe("1");
    expect(textarea.style.pointerEvents).toBe("auto");
    expect(textarea.style.width).toBe("var(--term-cell-width, 1ch)");
    expect(textarea.style.height).toBe("var(--term-row-height)");
    expect(textarea.value).toBe("\u200b");
    expect(textarea.selectionStart).toBe(1);
  });

  it("reports the initial Backspace once and each input-only repeat", () => {
    const keydown = new KeyboardEvent("keydown", {
      key: "Backspace",
      code: "Backspace",
      cancelable: true,
    });
    textarea.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(false);
    expect(received).toEqual(["\x7f"]);

    deleteInput();
    expect(received).toEqual(["\x7f"]);
    deleteInput();
    deleteInput();
    expect(received).toEqual(["\x7f", "\x7f", "\x7f"]);
    expect(textarea.value).toBe("\u200b");
  });

  it("accepts input-only deletion and preserves Kitty encoding", () => {
    bridge = {
      kittyKeyboardFlags: () => 31,
      cursorKeysApp: () => false,
    } as TerminalCore;
    deleteInput();
    expect(received).toEqual(["\x1b[127u"]);

    const keydown = new KeyboardEvent("keydown", {
      key: "Backspace",
      code: "Backspace",
      cancelable: true,
    });
    textarea.dispatchEvent(keydown);
    deleteInput();
    expect(keydown.defaultPrevented).toBe(false);
    expect(received).toEqual(["\x1b[127u", "\x1b[127u"]);
  });

  it("lets unmapped keys reach the textarea and strips the placeholder", () => {
    const keydown = new KeyboardEvent("keydown", {
      key: "Unidentified",
      cancelable: true,
    });
    textarea.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(false);
    textarea.value = "\u200bhello";
    textarea.dispatchEvent(
      new InputEvent("input", { inputType: "insertText" }),
    );
    expect(received).toEqual(["hello"]);
    expect(textarea.value).toBe("\u200b");
  });

  it("accepts native paste when clipboardData is unavailable", () => {
    bridge = { bracketedPaste: () => true } as TerminalCore;
    const paste = new Event("paste", { cancelable: true });
    textarea.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(false);
    textarea.value = "\u200bhello\x1b[201~";
    textarea.dispatchEvent(
      new InputEvent("input", { inputType: "insertFromPaste" }),
    );
    expect(received).toEqual(["\x1b[200~hello[201~\x1b[201~"]);
    expect(textarea.value).toBe("\u200b");
  });

  it("clears the placeholder for preedit and restores it after commit", () => {
    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(textarea.value).toBe("");
    textarea.value = "にほんご";
    textarea.dispatchEvent(
      new InputEvent("input", { inputType: "insertCompositionText" }),
    );
    expect(received).toEqual([]);
    textarea.dispatchEvent(
      new CompositionEvent("compositionend", { data: "日本語" }),
    );
    expect(received).toEqual(["日本語"]);
    expect(textarea.value).toBe("\u200b");
    textarea.value = "\u200b日本語";
    textarea.dispatchEvent(
      new InputEvent("input", { inputType: "insertText" }),
    );
    expect(received).toEqual(["日本語"]);
  });
});
