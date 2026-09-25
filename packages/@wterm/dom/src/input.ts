import type { TerminalCore } from "@wterm/core";
import { isLinkActivationModifier } from "./hyperlink.js";
import {
  encodeKittyKey,
  KITTY_REPORT_ALL,
  KITTY_REPORT_EVENTS,
  legacyControlByte,
} from "./kitty-keys.js";

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

const MODIFIED_CSI_KEYS: Record<string, string> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
  Home: "H",
  End: "F",
  F1: "P",
  F2: "Q",
  F3: "R",
  F4: "S",
};

const MODIFIED_TILDE_KEYS: Record<string, number> = {
  Insert: 2,
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
  F5: 15,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  F10: 21,
  F11: 23,
  F12: 24,
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

const COMPOSITION_INPUT_DEDUP_MS = 250;
const SCROLLBACK_BOTTOM_TOLERANCE = 5;
// iOS needs a deletable value to keep emitting input events for held Backspace.
const TOUCH_INPUT_PLACEHOLDER = "\u200b";

export class InputHandler {
  private element: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private onData: (data: string) => void;
  private onBinary: ((data: Uint8Array) => void) | undefined;
  private getBridge: () => TerminalCore | null;
  private getCellSize: () => {
    charWidth: number;
    rowHeight: number;
  } | null;
  private prepareComposition: () => void;
  private readonly touchPrimary: boolean;
  private composing = false;
  private compositionWidth = 0;
  private recentCompositionCommit: { text: string; at: number } | null = null;
  // The first native deletion mirrors the Backspace already sent on keydown.
  private suppressNextTouchDeleteInput = false;
  private mouseButtons = 0;
  private lastMouseMotion: {
    mode: number;
    encoding: string;
    code: number;
    x: number;
    y: number;
  } | null = null;
  private focused = false;
  private suppressedKeyUps = new Set<string>();
  private pressedModifiers = new Set<string>();
  private deliveredKeys = new Set<string>();

  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onKeyUp: (e: KeyboardEvent) => void;
  private _onPaste: (e: ClipboardEvent) => void;
  private _onCompositionStart: () => void;
  private _onCompositionEnd: (e: CompositionEvent) => void;
  private _onInput: (e: Event) => void;
  private _onFocus: () => void;
  private _onBlur: () => void;
  private _onMouseDown: (e: MouseEvent) => void;
  private _onHoverMove: (e: MouseEvent) => void;
  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseUp: (e: MouseEvent) => void;
  private _onMouseLeave: () => void;
  private _onWheel: (e: WheelEvent) => void;

  constructor(
    element: HTMLElement,
    onData: (data: string) => void,
    getBridge: () => TerminalCore | null,
    getCellSize: () => { charWidth: number; rowHeight: number } | null = () =>
      null,
    prepareComposition: () => void = () => {},
    onBinary?: (data: Uint8Array) => void,
  ) {
    this.element = element;
    this.onData = onData;
    this.onBinary = onBinary;
    this.getBridge = getBridge;
    this.getCellSize = getCellSize;
    this.prepareComposition = prepareComposition;
    this.touchPrimary =
      element.ownerDocument.defaultView?.matchMedia?.("(pointer: coarse)")
        .matches ?? false;

    this.textarea = document.createElement("textarea");
    this.textarea.setAttribute("autocapitalize", "off");
    this.textarea.setAttribute("autocomplete", "off");
    this.textarea.setAttribute("autocorrect", "off");
    this.textarea.setAttribute("spellcheck", "false");
    this.textarea.setAttribute("enterkeyhint", "send");
    this.textarea.setAttribute("tabindex", "0");
    this.textarea.setAttribute("aria-hidden", "true");
    this.textarea.wrap = "off";
    const s = this.textarea.style;
    s.position = "absolute";
    s.left = "-9999px";
    s.top = "0";
    s.width = this.touchPrimary ? "var(--term-cell-width, 1ch)" : "1px";
    s.height = this.touchPrimary ? "var(--term-row-height)" : "1px";
    s.boxSizing = "border-box";
    s.font = "inherit";
    s.lineHeight = "var(--term-row-height)";
    s.fontKerning = "none";
    s.fontVariantLigatures = "none";
    s.whiteSpace = "pre";
    s.zIndex = "2";
    // A fully transparent element is ignored by iOS keyboard and paste UI.
    s.opacity = this.touchPrimary ? "1" : "0";
    s.overflow = "hidden";
    s.border = "0";
    s.padding = "0";
    s.margin = "0";
    s.outline = "none";
    s.resize = "none";
    s.pointerEvents = this.touchPrimary ? "auto" : "none";
    s.caretColor = "transparent";
    s.color = "transparent";
    s.background = "transparent";
    element.appendChild(this.textarea);

    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    this._onPaste = this.handlePaste.bind(this);
    this._onCompositionStart = this.handleCompositionStart.bind(this);
    this._onCompositionEnd = this.handleCompositionEnd.bind(this);
    this._onInput = this.handleInput.bind(this);
    this._onFocus = () => {
      if (this.focused) return;
      this.focused = true;
      if (this.touchPrimary && !this.textarea.value) this.resetInputValue();
      this.positionTextarea();
      this.element.classList.add("focused");
      if (this.getBridge()?.focusEvents?.()) this.onData("\x1b[I");
    };
    this._onBlur = () => {
      this.focused = false;
      this.composing = false;
      this.recentCompositionCommit = null;
      this.suppressNextTouchDeleteInput = false;
      this.hideComposition();
      this.textarea.value = "";
      this.element.classList.remove("focused");
      this.stopMouseCapture();
      this.lastMouseMotion = null;
      this.pressedModifiers.clear();
      this.deliveredKeys.clear();
      if (this.getBridge()?.focusEvents?.()) this.onData("\x1b[O");
    };
    this._onMouseDown = (event) => this.handleMouse(event, "press");
    this._onHoverMove = (event) => {
      if (this.mouseButtons !== 0) return;
      if (event.buttons !== 0 || event.shiftKey) {
        this.lastMouseMotion = null;
        return;
      }
      this.handleMouse(event, "move");
    };
    this._onMouseMove = (event) => {
      if (this.mouseButtons !== 0) this.handleMouse(event, "move");
    };
    this._onMouseUp = (event) => {
      if (this.mouseButtons === 0) return;
      this.handleMouse(event, "release");
      this.mouseButtons = event.buttons & 7;
      if (this.mouseButtons === 0) this.stopMouseCapture();
    };
    this._onMouseLeave = () => {
      if (this.mouseButtons === 0) this.lastMouseMotion = null;
    };
    this._onWheel = (event) => this.handleMouse(event, "wheel");

    this.textarea.addEventListener("keydown", this._onKeyDown);
    this.textarea.addEventListener("keyup", this._onKeyUp);
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
    this.element.addEventListener("mousemove", this._onHoverMove);
    this.element.addEventListener("mouseleave", this._onMouseLeave);
    this.element.addEventListener("wheel", this._onWheel, { passive: false });
  }

  focus(): void {
    if (this.touchPrimary) this.prepareComposition();
    if (this.touchPrimary && !this.composing && !this.textarea.value) {
      this.resetInputValue();
    }
    this.positionTextarea();
    this.textarea.focus({ preventScroll: true });
  }

  syncInputPosition(): void {
    if (this.composing || this.touchPrimary) this.positionTextarea();
  }

  destroy(): void {
    this.textarea.removeEventListener("keydown", this._onKeyDown);
    this.textarea.removeEventListener("keyup", this._onKeyUp);
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
    this.element.removeEventListener("mousemove", this._onHoverMove);
    this.element.removeEventListener("mouseleave", this._onMouseLeave);
    this.stopMouseCapture();
    this.element.removeEventListener("wheel", this._onWheel);
    this.element.classList.remove("focused");
    this.textarea.remove();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const keyId = e.code || e.key;
    if (e.key !== "Backspace") this.suppressNextTouchDeleteInput = false;
    const physicalModifier = /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(
      e.code,
    );
    if (physicalModifier) {
      this.pressedModifiers.add(e.code);
    }
    if (this.composing || e.isComposing || e.keyCode === 229) {
      this.positionTextarea();
      this.suppressedKeyUps.add(keyId);
      return;
    }
    this.recentCompositionCommit = null;

    const bridge = this.getBridge();
    const kittyFlags = bridge?.kittyKeyboardFlags?.() ?? 0;
    const kittyOwnsModifier =
      physicalModifier && Boolean(kittyFlags & KITTY_REPORT_ALL);
    const delivered = this.deliveredKeys.has(keyId);

    if (!delivered && (e.metaKey || e.ctrlKey) && e.key === "c") {
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) {
        this.suppressedKeyUps.add(keyId);
        return;
      }
    }
    if (!delivered && (e.metaKey || e.ctrlKey) && e.key === "v") {
      this.suppressedKeyUps.add(keyId);
      this.textarea.focus();
      return;
    }
    if (!delivered && !kittyOwnsModifier && e.metaKey && !e.ctrlKey) {
      this.suppressedKeyUps.add(keyId);
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

    this.suppressedKeyUps.delete(keyId);
    const nativeTouchDelete =
      this.touchPrimary &&
      e.key === "Backspace" &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey;
    if (kittyFlags !== 0) {
      const seq = encodeKittyKey(
        e,
        kittyFlags,
        e.repeat ? "repeat" : "press",
        this.pressedModifiers,
        bridge?.cursorKeysApp?.() ?? false,
      );
      if (seq) {
        if (nativeTouchDelete) this.suppressNextTouchDeleteInput = true;
        else e.preventDefault();
        this.deliveredKeys.add(keyId);
        this.onData(seq);
      }
      return;
    }
    const seq = this.keyToSequence(e);
    if (seq) {
      if (nativeTouchDelete) this.suppressNextTouchDeleteInput = true;
      else e.preventDefault();
      this.onData(seq);
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const keyId = e.code || e.key;
    this.pressedModifiers.delete(e.code);
    this.deliveredKeys.delete(keyId);
    if (this.suppressedKeyUps.delete(keyId)) return;
    if (this.composing) return;
    const bridge = this.getBridge();
    const kittyFlags = bridge?.kittyKeyboardFlags?.() ?? 0;
    if (!(kittyFlags & KITTY_REPORT_EVENTS)) return;
    const seq = encodeKittyKey(
      e,
      kittyFlags,
      "release",
      this.pressedModifiers,
      bridge?.cursorKeysApp?.() ?? false,
    );
    if (!seq) return;
    e.preventDefault();
    this.onData(seq);
  }

  private handlePaste(e: ClipboardEvent): void {
    this.recentCompositionCommit = null;
    this.suppressNextTouchDeleteInput = false;
    const text = e.clipboardData?.getData("text");
    // Some mobile browsers leave clipboardData empty but insert the paste
    // into the textarea. Let that input event carry the text instead.
    if (!text) return;
    e.preventDefault();
    this.sendPaste(text);
  }

  private sendPaste(text: string): void {
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
    this.prepareComposition();
    this.composing = true;
    this.recentCompositionCommit = null;
    this.suppressNextTouchDeleteInput = false;
    if (this.touchPrimary && this.textarea.value === TOUCH_INPUT_PLACEHOLDER) {
      this.textarea.value = "";
    }
    this.positionTextarea();
    const s = this.textarea.style;
    s.opacity = "1";
    s.color = "var(--term-fg, currentColor)";
    s.background = "var(--term-bg, transparent)";
    s.caretColor = "var(--term-fg, currentColor)";
  }

  private handleCompositionEnd(e: CompositionEvent): void {
    this.composing = false;
    this.hideComposition();
    this.resetInputValue();
    if (e.data) {
      this.recentCompositionCommit = { text: e.data, at: performance.now() };
      this.onData(e.data);
    }
  }

  private hideComposition(): void {
    this.compositionWidth = 0;
    const s = this.textarea.style;
    s.opacity = this.touchPrimary ? "1" : "0";
    s.width = this.touchPrimary ? "var(--term-cell-width, 1ch)" : "1px";
    s.height = this.touchPrimary ? "var(--term-row-height)" : "1px";
    s.color = "transparent";
    s.background = "transparent";
    s.caretColor = "transparent";
  }

  private positionTextarea(): void {
    const bridge = this.getBridge();
    const cellSize = this.getCellSize();
    const firstRow = this.element.querySelector<HTMLElement>(
      ".term-row:not(.term-scrollback-row)",
    );
    if (!bridge || !cellSize || !firstRow || !bridge.getCursor) {
      this.textarea.style.left = "0px";
      this.textarea.style.top = "0px";
      if (this.composing) {
        this.textarea.style.width = `${Math.max(1, this.compositionWidth)}px`;
        this.textarea.style.height = `${cellSize?.rowHeight ?? 17}px`;
      }
      return;
    }

    const { charWidth, rowHeight } = cellSize;
    if (charWidth <= 0 || rowHeight <= 0) return;
    const cursor = bridge.getCursor();
    const col = Math.max(0, Math.min(cursor.col, bridge.getCols() - 1));
    const row = Math.max(0, Math.min(cursor.row, bridge.getRows() - 1));
    const hostRect = this.element.getBoundingClientRect();
    const rowRect = firstRow.getBoundingClientRect();
    const s = this.textarea.style;
    s.left = `${rowRect.left - hostRect.left - this.element.clientLeft + this.element.scrollLeft + col * charWidth}px`;
    s.top = `${rowRect.top - hostRect.top - this.element.clientTop + this.element.scrollTop + row * rowHeight}px`;
    if (this.composing) {
      s.width = `${Math.min(
        (bridge.getCols() - col) * charWidth,
        Math.max(charWidth, this.compositionWidth),
      )}px`;
      s.height = `${rowHeight}px`;
    }
  }

  private sizeComposition(): void {
    const charWidth = this.getCellSize()?.charWidth;
    if (!charWidth || charWidth <= 0) return;
    // With wrapping disabled, scrollWidth measures the full preedit even when
    // it is longer than the field. Leave a cell for the IME caret.
    this.textarea.style.width = "1px";
    this.compositionWidth = this.textarea.value
      ? Math.max(charWidth, this.textarea.scrollWidth + charWidth)
      : charWidth;
    this.positionTextarea();
  }

  private resetInputValue(): void {
    this.textarea.value = this.touchPrimary ? TOUCH_INPUT_PLACEHOLDER : "";
    if (this.touchPrimary) this.textarea.setSelectionRange(1, 1);
  }

  private sendTouchDelete(): void {
    const bridge = this.getBridge();
    const flags = bridge?.kittyKeyboardFlags?.() ?? 0;
    const seq = flags
      ? encodeKittyKey(
          new KeyboardEvent("keydown", {
            key: "Backspace",
            code: "Backspace",
          }),
          flags,
          "press",
          undefined,
          bridge?.cursorKeysApp?.() ?? false,
        )
      : "\x7f";
    if (seq) this.onData(seq);
  }

  private handleInput(event: Event): void {
    if (this.composing) {
      this.sizeComposition();
      return;
    }
    const inputType = (event as InputEvent).inputType;
    const rawValue = this.textarea.value;
    const value =
      this.touchPrimary && rawValue.startsWith(TOUCH_INPUT_PLACEHOLDER)
        ? rawValue.slice(TOUCH_INPUT_PLACEHOLDER.length)
        : rawValue;
    this.resetInputValue();
    const recent = this.recentCompositionCommit;
    this.recentCompositionCommit = null;
    if (this.touchPrimary && inputType === "deleteContentBackward") {
      if (this.suppressNextTouchDeleteInput) {
        this.suppressNextTouchDeleteInput = false;
      } else {
        this.sendTouchDelete();
      }
      return;
    }
    this.suppressNextTouchDeleteInput = false;
    if (!value) return;
    // Some browsers emit the committed text again as an ordinary input
    // event immediately after compositionend, with varying inputType values.
    if (
      recent &&
      value === recent.text &&
      performance.now() - recent.at < COMPOSITION_INPUT_DEDUP_MS
    )
      return;
    if (inputType === "insertFromPaste") this.sendPaste(value);
    else this.onData(value);
  }

  private handleMouse(
    event: MouseEvent | WheelEvent,
    kind: "press" | "move" | "release" | "wheel",
  ): void {
    const bridge = this.getBridge();
    const tracking = bridge?.mouseTracking?.() ?? 0;
    const encoding =
      bridge?.mouseEncoding?.() ?? (bridge?.mouseSgr?.() ? "sgr" : null);
    if (
      !bridge ||
      tracking === 0 ||
      (encoding !== "sgr" &&
        encoding !== "sgr-pixels" &&
        encoding !== "x10" &&
        encoding !== "utf8" &&
        encoding !== "urxvt")
    ) {
      this.lastMouseMotion = null;
      return;
    }
    if (kind === "wheel") {
      const wheel = event as WheelEvent;
      const maxScrollTop =
        this.element.scrollHeight - this.element.clientHeight;
      if (
        maxScrollTop > 0 &&
        (wheel.shiftKey ||
          maxScrollTop - this.element.scrollTop > SCROLLBACK_BOTTOM_TOLERANCE)
      ) {
        this.lastMouseMotion = null;
        if (wheel.shiftKey) {
          const delta =
            Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)
              ? wheel.deltaX
              : wheel.deltaY;
          const scale =
            wheel.deltaMode === 1
              ? (this.getCellSize()?.rowHeight ?? 16)
              : wheel.deltaMode === 2
                ? this.element.clientHeight
                : 1;
          if (delta !== 0) {
            this.element.scrollTop += delta * scale;
            wheel.preventDefault();
          }
        }
        return;
      }
    }
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
    const reportMotion =
      tracking === 1003 || (tracking === 1002 && supportedButtons !== 0);
    if (kind === "move" && !reportMotion) {
      this.lastMouseMotion = null;
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
    const cols = bridge.getCols();
    const rows = bridge.getRows();
    const gridWidth = charWidth * cols;
    const gridHeight = rowHeight * rows;
    if (
      !Number.isFinite(gridWidth) ||
      !Number.isFinite(gridHeight) ||
      gridWidth <= 0 ||
      gridHeight <= 0
    )
      return;
    const outsideGrid =
      event.clientX < left ||
      event.clientX >= left + gridWidth ||
      event.clientY < top ||
      event.clientY >= top + gridHeight;
    if (
      outsideGrid &&
      (kind === "press" ||
        kind === "wheel" ||
        (kind === "move" && supportedButtons === 0))
    ) {
      this.lastMouseMotion = null;
      return;
    }
    const pixels = encoding === "sgr-pixels";
    // Pointer positions and grid measurements use CSS pixels on every display.
    const x = Math.max(
      1,
      Math.min(
        pixels ? Math.ceil(gridWidth) : cols,
        Math.floor((event.clientX - left) / (pixels ? 1 : charWidth)) + 1,
      ),
    );
    const y = Math.max(
      1,
      Math.min(
        pixels ? Math.ceil(gridHeight) : rows,
        Math.floor((event.clientY - top) / (pixels ? 1 : rowHeight)) + 1,
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
        kind === "release" && encoding !== "sgr" && !pixels
          ? 3
          : kind === "move"
            ? supportedButtons === 0
              ? 3
              : supportedButtons & 4
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
    const legacy =
      encoding === "x10"
        ? Uint8Array.of(0x1b, 0x5b, 0x4d, code + 32, x + 32, y + 32)
        : null;
    if (
      legacy &&
      (x > 223 ||
        y > 223 ||
        (!this.onBinary && (legacy[4] > 127 || legacy[5] > 127)))
    ) {
      this.lastMouseMotion = null;
      return;
    }
    if (encoding === "utf8" && (x > 2015 || y > 2015)) {
      this.lastMouseMotion = null;
      return;
    }
    if (kind === "move") {
      const previous = this.lastMouseMotion;
      if (
        previous?.mode === tracking &&
        previous.encoding === encoding &&
        previous.code === code &&
        previous.x === x &&
        previous.y === y
      ) {
        return;
      }
      this.lastMouseMotion = { mode: tracking, encoding, code, x, y };
    } else {
      this.lastMouseMotion = null;
    }
    if (kind === "press") {
      this.textarea.focus({ preventScroll: true });
      if (!this.focused) this._onFocus();
      this.mouseButtons =
        supportedButtons ||
        (event.button === 1 ? 4 : event.button === 2 ? 2 : 1);
      view.addEventListener("mousemove", this._onMouseMove);
      view.addEventListener("mouseup", this._onMouseUp);
    }
    event.preventDefault();
    if (legacy) {
      if (this.onBinary) this.onBinary(legacy);
      else this.onData(String.fromCharCode(...legacy));
    } else if (encoding === "utf8") {
      this.onData(`\x1b[M${String.fromCodePoint(code + 32, x + 32, y + 32)}`);
    } else if (encoding === "urxvt") {
      this.onData(`\x1b[${code + 32};${x};${y}M`);
    } else {
      this.onData(`\x1b[<${code};${x};${y}${final}`);
    }
  }

  private stopMouseCapture(): void {
    this.mouseButtons = 0;
    const view = this.element.ownerDocument.defaultView;
    view?.removeEventListener("mousemove", this._onMouseMove);
    view?.removeEventListener("mouseup", this._onMouseUp);
  }

  private keyToSequence(e: KeyboardEvent): string | null {
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const control = legacyControlByte(e.key);
      if (control !== null) return control;
      if (e.key === "Backspace") return "\x08";
    }

    if (e.key === "Enter" && e.shiftKey) return "\x1b[13;2u";
    if (e.key === "Tab" && e.shiftKey) return "\x1b[Z";

    if (!e.metaKey && (e.shiftKey || e.altKey || e.ctrlKey)) {
      const modifier =
        1 + Number(e.shiftKey) + 2 * Number(e.altKey) + 4 * Number(e.ctrlKey);
      const final = MODIFIED_CSI_KEYS[e.key];
      if (final) return `\x1b[1;${modifier}${final}`;
      const tilde = MODIFIED_TILDE_KEYS[e.key];
      if (tilde) return `\x1b[${tilde};${modifier}~`;
    }

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
