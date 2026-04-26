import type { WasmBridge } from "@wterm/core";

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

interface CursorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class InputHandler {
  private element: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private compositionView: HTMLSpanElement;
  private onData: (data: string) => void;
  private getBridge: () => WasmBridge | null;
  private composing = false;
  private _cursorObserver: MutationObserver;

  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onPaste: (e: ClipboardEvent) => void;
  private _onCompositionStart: () => void;
  private _onCompositionUpdate: (e: CompositionEvent) => void;
  private _onCompositionEnd: (e: CompositionEvent) => void;
  private _onInput: () => void;
  private _onFocus: () => void;
  private _onBlur: () => void;

  constructor(
    element: HTMLElement,
    onData: (data: string) => void,
    getBridge: () => WasmBridge | null,
  ) {
    this.element = element;
    this.onData = onData;
    this.getBridge = getBridge;

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
    s.left = "0";
    s.top = "0";
    s.width = "1ch";
    s.height = "1.2em";
    s.opacity = "0";
    s.zIndex = "10";
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

    this.compositionView = document.createElement("span");
    this.compositionView.className = "term-composition";
    const cs = this.compositionView.style;
    cs.position = "absolute";
    cs.font = "inherit";
    cs.color = "inherit";
    cs.background = "var(--term-bg, #1e1e1e)";
    cs.whiteSpace = "pre";
    cs.textDecoration = "underline";
    cs.zIndex = "50";
    cs.pointerEvents = "none";
    cs.padding = "0";
    cs.margin = "0";
    cs.border = "0";
    cs.display = "none";
    element.appendChild(this.compositionView);

    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onPaste = this.handlePaste.bind(this);
    this._onCompositionStart = this.handleCompositionStart.bind(this);
    this._onCompositionUpdate = this.handleCompositionUpdate.bind(this);
    this._onCompositionEnd = this.handleCompositionEnd.bind(this);
    this._onInput = this.handleInput.bind(this);
    this._onFocus = () => {
      this.element.classList.add("focused");
      this._positionTextareaAtCursor();
    };
    this._onBlur = () => this.element.classList.remove("focused");

    this.textarea.addEventListener("keydown", this._onKeyDown);
    this.textarea.addEventListener("paste", this._onPaste as EventListener);
    this.textarea.addEventListener(
      "compositionstart",
      this._onCompositionStart,
    );
    this.textarea.addEventListener(
      "compositionupdate",
      this._onCompositionUpdate as EventListener,
    );
    this.textarea.addEventListener(
      "compositionend",
      this._onCompositionEnd as EventListener,
    );
    this.textarea.addEventListener("input", this._onInput);
    this.textarea.addEventListener("focus", this._onFocus);
    this.textarea.addEventListener("blur", this._onBlur);

    this._cursorObserver = new MutationObserver(() =>
      this._positionTextareaAtCursor(),
    );
    this._cursorObserver.observe(element, { childList: true, subtree: true });
    this._positionTextareaAtCursor();
  }

  private _getCursorRect(): CursorRect | null {
    const cursorEl = this.element.querySelector(".term-cursor");
    if (!cursorEl) return null;
    const elRect = this.element.getBoundingClientRect();
    const r = cursorEl.getBoundingClientRect();
    return {
      left: r.left - elRect.left + this.element.scrollLeft,
      top: r.top - elRect.top + this.element.scrollTop,
      width: r.width,
      height: r.height,
    };
  }

  private _positionTextareaAtCursor(): void {
    const rect = this._getCursorRect();
    if (!rect) return;
    const s = this.textarea.style;
    s.left = rect.left + "px";
    s.top = rect.top + "px";
    s.width = Math.max(1, rect.width) + "px";
    s.height = Math.max(1, rect.height) + "px";
  }

  focus(): void {
    this.textarea.focus({ preventScroll: true });
  }

  destroy(): void {
    this._cursorObserver?.disconnect();
    this.textarea.removeEventListener("keydown", this._onKeyDown);
    this.textarea.removeEventListener("paste", this._onPaste as EventListener);
    this.textarea.removeEventListener(
      "compositionstart",
      this._onCompositionStart,
    );
    this.textarea.removeEventListener(
      "compositionupdate",
      this._onCompositionUpdate as EventListener,
    );
    this.textarea.removeEventListener(
      "compositionend",
      this._onCompositionEnd as EventListener,
    );
    this.textarea.removeEventListener("input", this._onInput);
    this.textarea.removeEventListener("focus", this._onFocus);
    this.textarea.removeEventListener("blur", this._onBlur);
    this.element.classList.remove("focused");
    this.textarea.remove();
    this.compositionView.remove();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // IME first keystroke fires keydown with keyCode 229 before
    // compositionstart; bail early so the raw key isn't sent to the PTY.
    if (this.composing || e.isComposing || e.keyCode === 229) return;

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
    this._positionTextareaAtCursor();
    this._showCompositionView();
  }

  private handleCompositionUpdate(e: CompositionEvent): void {
    this.compositionView.textContent = e.data || "";
  }

  private handleCompositionEnd(e: CompositionEvent): void {
    this.composing = false;
    this._hideCompositionView();
    if (e.data) this.onData(e.data);
    this.textarea.value = "";
  }

  private _showCompositionView(): void {
    const rect = this._getCursorRect();
    const cs = this.compositionView.style;
    if (rect) {
      cs.left = rect.left + "px";
      cs.top = rect.top + "px";
      cs.height = rect.height + "px";
      cs.lineHeight = rect.height + "px";
    }
    cs.display = "inline-block";
  }

  private _hideCompositionView(): void {
    this.compositionView.style.display = "none";
    this.compositionView.textContent = "";
  }

  private handleInput(): void {
    if (this.composing) return;
    const value = this.textarea.value;
    if (value) {
      this.onData(value);
      this.textarea.value = "";
    }
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
