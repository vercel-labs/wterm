import { WasmBridge } from "@wterm/core";
import { Renderer } from "./renderer.js";
import { InputHandler } from "./input.js";

export interface WTermOptions {
  cols?: number;
  rows?: number;
  wasmUrl?: string;
  autoResize?: boolean;
  cursorBlink?: boolean;
  onData?: (data: string) => void;
  onTitle?: (title: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export class WTerm {
  element: HTMLElement;
  cols: number;
  rows: number;
  bridge: WasmBridge | null = null;
  autoResize: boolean;

  private wasmUrl: string | undefined;
  private renderer: Renderer | null = null;
  private input: InputHandler | null = null;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private _destroyed = false;
  private _shouldScrollToBottom = false;
  private _onClickFocus: () => void;

  onData: ((data: string) => void) | null;
  onTitle: ((title: string) => void) | null;
  onResize: ((cols: number, rows: number) => void) | null;

  private _container: HTMLDivElement;

  constructor(element: HTMLElement, options: WTermOptions = {}) {
    this.element = element;
    this.wasmUrl = options.wasmUrl;
    this.cols = options.cols || 80;
    this.rows = options.rows || 24;
    this.autoResize = options.autoResize !== false;

    this.onData = options.onData || null;
    this.onTitle = options.onTitle || null;
    this.onResize = options.onResize || null;

    this._container = document.createElement("div");
    this._container.className = "term-grid";
    this.element.appendChild(this._container);
    this.element.classList.add("wterm");
    if (options.cursorBlink) this.element.classList.add("cursor-blink");

    this._onClickFocus = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) this.input?.focus();
    };
    this.element.addEventListener("click", this._onClickFocus);
  }

  async init(): Promise<this> {
    try {
      this.bridge = await WasmBridge.load(this.wasmUrl);
      if (this._destroyed) return this;
      this.bridge.init(this.cols, this.rows);

      this.renderer = new Renderer(this._container);
      this.renderer.setup(this.cols, this.rows);

      this.input = new InputHandler(
        this.element,
        (data) => {
          if (this.onData) {
            this.onData(data);
          } else {
            this.write(data);
          }
        },
        () => this.bridge,
      );

      if (this.autoResize) {
        this._setupResizeObserver();
      } else {
        this._lockHeight();
      }

      this.input.focus();
      this._initialRender();
    } catch (err) {
      this.destroy();
      throw new Error(
        `wterm: failed to initialize: ${err instanceof Error ? err.message : err}`,
      );
    }

    return this;
  }

  private _isScrolledToBottom(): boolean {
    const el = this.element;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 5;
  }

  private _scrollToBottom(): void {
    this.element.scrollTop = this.element.scrollHeight;
  }

  write(data: string | Uint8Array): void {
    if (!this.bridge) return;
    this._shouldScrollToBottom = this._isScrolledToBottom();
    if (typeof data === "string") {
      this.bridge.writeString(data);
    } else {
      this.bridge.writeRaw(data);
    }
    this._scheduleRender();
  }

  resize(cols: number, rows: number): void {
    if (!this.bridge) return;
    this._shouldScrollToBottom = this._isScrolledToBottom();
    this.cols = cols;
    this.rows = rows;
    this.bridge.resize(cols, rows);
    this.renderer?.setup(cols, rows);
    this._scheduleRender();
    if (this.onResize) this.onResize(cols, rows);
  }

  focus(): void {
    if (this.input) {
      this.input.focus();
    } else {
      this.element.focus();
    }
  }

  private _scheduleRender(): void {
    if (this.rafId == null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this._doRender();
      });
    }
  }

  private _initialRender(): void {
    this._doRender();
  }

  private _doRender(): void {
    if (!this.bridge || !this.renderer) return;

    this.renderer.render(this.bridge);

    const hasScrollback = this.bridge.getScrollbackCount() > 0;
    this.element.classList.toggle("has-scrollback", hasScrollback);

    if (this._shouldScrollToBottom) {
      this._scrollToBottom();
    }

    const title = this.bridge.getTitle();
    if (title !== null && this.onTitle) {
      this.onTitle(title);
    }

    const response = this.bridge.getResponse();
    if (response !== null && this.onData) {
      this.onData(response);
    }
  }

  private _lockHeight(): void {
    const cs = getComputedStyle(this.element);
    const rowHeight =
      parseFloat(cs.getPropertyValue("--term-row-height")) || 17;
    const gridHeight = this.rows * rowHeight;
    let extra =
      (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    if (cs.boxSizing === "border-box") {
      extra +=
        (parseFloat(cs.borderTopWidth) || 0) +
        (parseFloat(cs.borderBottomWidth) || 0);
    }
    this.element.style.height = `${gridHeight + extra}px`;
  }

  private _measureCharSize(): { width: number; height: number } | null {
    const probe = document.createElement("span");
    probe.className = "term-cell";
    probe.textContent = "W";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    this._container.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    probe.remove();
    if (width === 0 || height === 0) return null;
    return { width, height };
  }

  private _setupResizeObserver(): void {
    const initial = this._measureCharSize();
    if (!initial) return;

    let charWidth = initial.width;
    let charHeight = initial.height;

    this.resizeObserver = new ResizeObserver((entries) => {
      const measured = this._measureCharSize();
      if (measured) {
        charWidth = measured.width;
        charHeight = measured.height;
      }

      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const newCols = Math.max(1, Math.floor(width / charWidth));
        const newRows = Math.max(1, Math.floor(height / charHeight));
        if (newCols !== this.cols || newRows !== this.rows) {
          this.resize(newCols, newRows);
        }
      }
    });
    this.resizeObserver.observe(this.element);
  }

  destroy(): void {
    this._destroyed = true;
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.input) this.input.destroy();
    this.element.removeEventListener("click", this._onClickFocus);
    this.element.innerHTML = "";
  }
}
