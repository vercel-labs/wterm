import type { TerminalCore } from "@wterm/core";
import { isLinkActivationModifier } from "./hyperlink.js";

const NORMAL_KEYS: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
};

const APP_KEYS: Record<string, string> = {
  ArrowUp: "\x1bOA",
  ArrowDown: "\x1bOB",
  ArrowRight: "\x1bOC",
  ArrowLeft: "\x1bOD",
  Home: "\x1bOH",
  End: "\x1bOF",
};

const FIXED_KEYS: Record<string, string> = {
  Enter: "\r",
  Backspace: "\x7f",
  Tab: "\t",
  Escape: "\x1b",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

export class InputHandler {
  private element: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private onData: (data: string) => void;
  private getBridge: () => TerminalCore | null;
  private getCellSize: () => {
    charWidth: number;
    rowHeight: number;
  } | null;
  private composing = false;
  private mouseButtons = 0;
  private focused = false;

  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onPaste: (e: ClipboardEvent) => void;
  private _onCompositionStart: () => void;
  private _onCompositionEnd: (e: CompositionEvent) => void;
  private _onInput: () => void;
  private _onFocus: () => void;
  private _onBlur: () => void;
  private _onMouseDown: (e: MouseEvent) => void;
  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseUp: (e: MouseEvent) => void;
  private _onWheel: (e: WheelEvent) => void;

  constructor(
    element: HTMLElement,
    onData: (data: string) => void,
    getBridge: () => TerminalCore | null,
    getCellSize: () => { charWidth: number; rowHeight: number } | null = () =>
      null,
  ) {
    this.element = element;
    this.onData = onData;
    this.getBridge = getBridge;
    this.getCellSize = getCellSize;

    this.textarea = document.createElement("textarea");
    this.textarea.setAttribute("autocapitalize", "off");
    this.textarea.setAttribute("autocomplete", "off");
    this.textarea.setAttribute("autocorrect", "off");
    this.textarea.setAttribute("spellcheck", "false");
    this.textarea.setAttribute("enterkeyhint", "send");
    this.textarea.setAttribute("tabindex", "0");
    this.textarea.setAttribute("aria-hidden", "true");
    const s = this.textarea.style;
    s.position = "absolute";
    s.left = "-9999px";
    s.top = "0";
    s.width = "1px";
    s.height = "1px";
    s.opacity = "0";
    s.overflow = "hidden";
    s.border = "0";
    s.padding = "0";
    s.margin = "0";
    s.outline = "none";
    s.resize = "none";
    s.pointerEvents = "none";
    s.caretColor = "transparent";
    s.color = "transparent";
    s.background = "transparent";
    element.appendChild(this.textarea);

    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onPaste = this.handlePaste.bind(this);
    this._onCompositionStart = this.handleCompositionStart.bind(this);
    this._onCompositionEnd = this.handleCompositionEnd.bind(this);
    this._onInput = this.handleInput.bind(this);
    this._onFocus = () => {
      if (this.focused) return;
      this.focused = true;
      this.element.classList.add("focused");
      if (this.getBridge()?.focusEvents?.()) this.onData("\x1b[I");
    };
    this._onBlur = () => {
      this.focused = false;
      this.element.classList.remove("focused");
      this.stopMouseCapture();
      if (this.getBridge()?.focusEvents?.()) this.onData("\x1b[O");
    };
    this._onMouseDown = (event) => this.handleMouse(event, "press");
    this._onMouseMove = (event) => {
      if (this.mouseButtons !== 0) this.handleMouse(event, "move");
    };
    this._onMouseUp = (event) => {
      if (this.mouseButtons === 0) return;
      this.handleMouse(event, "release");
      this.mouseButtons = event.buttons & 7;
      if (this.mouseButtons === 0) this.stopMouseCapture();
    };
    this._onWheel = (event) => this.handleMouse(event, "wheel");

    this.textarea.addEventListener("keydown", this._onKeyDown);
    this.textarea.addEventListener("paste", this._onPaste as EventListener);
    this.textarea.addEventListener(
      "compositionstart",
      this._onCompositionStart,
    );
    this.textarea.addEventListener(
      "compositionend",
      this._onCompositionEnd as EventListener,
    );
    this.textarea.addEventListener("input", this._onInput);
    this.textarea.addEventListener("focus", this._onFocus);
    this.textarea.addEventListener("blur", this._onBlur);
    this.element.addEventListener("mousedown", this._onMouseDown);
    this.element.addEventListener("wheel", this._onWheel, { passive: false });
  }

  focus(): void {
    this.textarea.focus({ preventScroll: true });
  }

  destroy(): void {
    this.textarea.removeEventListener("keydown", this._onKeyDown);
    this.textarea.removeEventListener("paste", this._onPaste as EventListener);
    this.textarea.removeEventListener(
      "compositionstart",
      this._onCompositionStart,
    );
    this.textarea.removeEventListener(
      "compositionend",
      this._onCompositionEnd as EventListener,
    );
    this.textarea.removeEventListener("input", this._onInput);
    this.textarea.removeEventListener("focus", this._onFocus);
    this.textarea.removeEventListener("blur", this._onBlur);
    this.element.removeEventListener("mousedown", this._onMouseDown);
    this.stopMouseCapture();
    this.element.removeEventListener("wheel", this._onWheel);
    this.element.classList.remove("focused");
    this.textarea.remove();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.composing) return;

    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "v") {
      this.textarea.focus();
      return;
    }
    if (e.metaKey && !e.ctrlKey) {
      if (e.key === "Backspace") {
        e.preventDefault();
        this.onData("\x15");
      } else if (e.key === "a") {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(this.element);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      return;
    }

    e.preventDefault();
    const seq = this.keyToSequence(e);
    if (seq) this.onData(seq);
  }

  private handlePaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData("text");
    if (!text) return;

    const bridge = this.getBridge();
    if (bridge && bridge.bracketedPaste()) {
      // Strip ESC bytes so clipboard payloads cannot inject \x1b[201~ to
      // break out of bracketed paste mode and smuggle commands to the PTY.
      const safe = text.replace(/\x1b/g, "");
      this.onData("\x1b[200~" + safe + "\x1b[201~");
    } else {
      this.onData(text);
    }
  }

  private handleCompositionStart(): void {
    this.composing = true;
  }

  private handleCompositionEnd(e: CompositionEvent): void {
    this.composing = false;
    if (e.data) this.onData(e.data);
    this.textarea.value = "";
  }

  private handleInput(): void {
    if (this.composing) return;
    const value = this.textarea.value;
    if (value) {
      this.onData(value);
      this.textarea.value = "";
    }
  }

  private handleMouse(
    event: MouseEvent | WheelEvent,
    kind: "press" | "move" | "release" | "wheel",
  ): void {
    const bridge = this.getBridge();
    const tracking = bridge?.mouseTracking?.() ?? 0;
    if (!bridge || tracking === 0 || !bridge.mouseSgr?.()) return;
    if (
      kind === "press" &&
      isLinkActivationModifier(
        event,
        this.element.ownerDocument.defaultView?.navigator ?? navigator,
      ) &&
      event.target instanceof Element &&
      event.target.closest(".term-link")
    ) {
      return;
    }
    if (kind === "press" && (event.shiftKey || event.button > 2)) return;
    if (kind === "release" && event.button > 2) return;
    const supportedButtons = event.buttons & 7;
    if (kind === "move" && (tracking !== 1002 || supportedButtons === 0)) {
      return;
    }

    const view = this.element.ownerDocument.defaultView;
    if (!view) return;
    const viewportRow = this.element.querySelector<HTMLElement>(
      ".term-row:not(.term-scrollback-row)",
    );
    const hostRect = this.element.getBoundingClientRect();
    const rowRect = viewportRow?.getBoundingClientRect();
    const cellSize = this.getCellSize();
    let left: number;
    let top: number;
    let charWidth: number;
    let rowHeight: number;
    if (rowRect && cellSize) {
      left = rowRect.left;
      top = rowRect.top;
      charWidth = cellSize.charWidth;
      rowHeight = cellSize.rowHeight;
    } else {
      const style = view.getComputedStyle(this.element);
      const borderLeft = parseFloat(style.borderLeftWidth) || 0;
      const borderRight = parseFloat(style.borderRightWidth) || 0;
      const borderTop = parseFloat(style.borderTopWidth) || 0;
      const borderBottom = parseFloat(style.borderBottomWidth) || 0;
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const paddingTop = parseFloat(style.paddingTop) || 0;
      const paddingBottom = parseFloat(style.paddingBottom) || 0;
      left = rowRect?.left ?? hostRect.left + borderLeft + paddingLeft;
      top = rowRect?.top ?? hostRect.top + borderTop + paddingTop;
      charWidth =
        (hostRect.width -
          borderLeft -
          borderRight -
          paddingLeft -
          paddingRight) /
        bridge.getCols();
      rowHeight =
        (hostRect.height -
          borderTop -
          borderBottom -
          paddingTop -
          paddingBottom) /
        bridge.getRows();
    }
    if (charWidth <= 0 || rowHeight <= 0) return;
    if (kind === "press") {
      this.textarea.focus({ preventScroll: true });
      if (!this.focused) this._onFocus();
      this.mouseButtons =
        supportedButtons ||
        (event.button === 1 ? 4 : event.button === 2 ? 2 : 1);
      view.addEventListener("mousemove", this._onMouseMove);
      view.addEventListener("mouseup", this._onMouseUp);
    }
    const col = Math.max(
      1,
      Math.min(
        bridge.getCols(),
        Math.floor((event.clientX - left) / charWidth) + 1,
      ),
    );
    const row = Math.max(
      1,
      Math.min(
        bridge.getRows(),
        Math.floor((event.clientY - top) / rowHeight) + 1,
      ),
    );
    const modifiers =
      (event.shiftKey ? 4 : 0) |
      (event.altKey ? 8 : 0) |
      (event.ctrlKey ? 16 : 0);
    let code: number;
    let final = "M";
    if (kind === "wheel") {
      const wheel = event as WheelEvent;
      if (Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)) {
        if (wheel.deltaX === 0) return;
        code = (wheel.deltaX < 0 ? 66 : 67) | modifiers;
      } else {
        if (wheel.deltaY === 0) return;
        code = (wheel.deltaY < 0 ? 64 : 65) | modifiers;
      }
    } else {
      const button =
        kind === "move"
          ? supportedButtons & 4
            ? 1
            : supportedButtons & 2
              ? 2
              : 0
          : event.button === 1
            ? 1
            : event.button === 2
              ? 2
              : 0;
      code = button | modifiers | (kind === "move" ? 32 : 0);
      if (kind === "release") final = "m";
    }
    event.preventDefault();
    this.onData(`\x1b[<${code};${col};${row}${final}`);
  }

  private stopMouseCapture(): void {
    this.mouseButtons = 0;
    const view = this.element.ownerDocument.defaultView;
    view?.removeEventListener("mousemove", this._onMouseMove);
    view?.removeEventListener("mouseup", this._onMouseUp);
  }

  private keyToSequence(e: KeyboardEvent): string | null {
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key.length === 1) {
        const code = e.key.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
      }
      if (e.key === "[") return "\x1b";
      if (e.key === "\\") return "\x1c";
      if (e.key === "]") return "\x1d";
      if (e.key === "^") return "\x1e";
      if (e.key === "_") return "\x1f";
    }

    if (e.key === "Enter" && e.shiftKey) return "\x1b[13;2u";
    if (e.key === "Tab" && e.shiftKey) return "\x1b[Z";

    const fixed = FIXED_KEYS[e.key];
    if (fixed) return e.altKey ? "\x1b" + fixed : fixed;

    const bridge = this.getBridge();
    const appMode = bridge && bridge.cursorKeysApp();
    const navMap = appMode ? APP_KEYS : NORMAL_KEYS;
    const nav = navMap[e.key];
    if (nav) return e.altKey ? "\x1b" + nav : nav;

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      return e.altKey ? "\x1b" + e.key : e.key;
    }

    return null;
  }
}
