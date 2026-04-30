import { WasmBridge, type TerminalCore } from "@wterm/core";
import { Renderer } from "./renderer.js";
import { InputHandler } from "./input.js";
import { DebugAdapter } from "./debug.js";

export interface WTermOptions {
  cols?: number;
  rows?: number;
  /**
   * A pre-constructed terminal core. When provided, `wasmUrl` is ignored and
   * this core is used directly instead of loading the built-in Zig WASM binary.
   */
  core?: TerminalCore;
  wasmUrl?: string;
  autoResize?: boolean;
  cursorBlink?: boolean;
  debug?: boolean;
  onData?: (data: string) => void;
  onTitle?: (title: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export class WTerm {
  element: HTMLElement;
  cols: number;
  rows: number;
  bridge: TerminalCore | null = null;
  autoResize: boolean;
  debug: DebugAdapter | null = null;

  private _coreOption: TerminalCore | undefined;
  private wasmUrl: string | undefined;
  private _debugEnabled: boolean;
  private renderer: Renderer | null = null;
  private input: InputHandler | null = null;
  private rafId: number | null = null;
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private _destroyed = false;
  private _shouldScrollToBottom = false;
  private _rowHeight = 0;
  private _onClickFocus: () => void;

  onData: ((data: string) => void) | null;
  onTitle: ((title: string) => void) | null;
  onResize: ((cols: number, rows: number) => void) | null;

  private _container: HTMLDivElement;

  constructor(element: HTMLElement, options: WTermOptions = {}) {
    this.element = element;
    this._coreOption = options.core;
    this.wasmUrl = options.wasmUrl;
    this.cols = options.cols || 80;
    this.rows = options.rows || 24;
    this.autoResize = options.autoResize !== false;
    this._debugEnabled = options.debug ?? false;

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
      if (this._coreOption) {
        this.bridge = this._coreOption;
      } else {
        this.bridge = await WasmBridge.load(this.wasmUrl);
      }
      if (this._destroyed) return this;
      this.bridge.init(this.cols, this.rows);

      if (this._debugEnabled) {
        this.debug = new DebugAdapter();
        this.debug.setBridge(this.bridge);
        (globalThis as Record<string, unknown>).__wterm = this;
      }

      this._setRowHeight();

      this.renderer = new Renderer(this._container);
      this.renderer.setup(this.cols, this.rows);

      this.input = new InputHandler(
        this.element,
        (data) => {
          this._scrollToBottom();
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
    const el = this.element;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) {
      el.scrollTop = 0;
      return;
    }
    const rh = this._rowHeight || 17;
    el.scrollTop = Math.floor(maxScroll / rh) * rh;
  }

  write(data: string | Uint8Array): void {
    if (!this.bridge) return;
    if (this.debug) this.debug.traceWrite(data);
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
    if (this._renderTimer != null) return;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      if (this.rafId == null) {
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          this._doRender();
        });
      }
    }, 0);
  }

  private _initialRender(): void {
    this._doRender();
  }

  private _doRender(): void {
    if (!this.bridge || !this.renderer) return;

    let dirtyCount = 0;
    const t0 = this.debug ? performance.now() : 0;
    if (this.debug) {
      for (let r = 0; r < this.rows; r++) {
        if (this.bridge.isDirtyRow(r)) dirtyCount++;
      }
    }

    this.renderer.render(this.bridge);

    if (this.debug) {
      this.debug.recordRender(performance.now() - t0, dirtyCount);
    }

    const hasScrollback = this.bridge.getScrollbackCount() > 0;
    this.element.classList.toggle("has-scrollback", hasScrollback);

    if (this._shouldScrollToBottom) {
      this._scrollToBottom();
    } else if (!hasScrollback && this.element.scrollTop !== 0) {
      this.element.scrollTop = 0;
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
    const rh = this._rowHeight || 17;
    const gridHeight = this.rows * rh;
    const cs = getComputedStyle(this.element);
    let extra =
      (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    if (cs.boxSizing === "border-box") {
      extra +=
        (parseFloat(cs.borderTopWidth) || 0) +
        (parseFloat(cs.borderBottomWidth) || 0);
    }
    this.element.style.height = `${gridHeight + extra}px`;
  }

  private _setRowHeight(): void {
    const probe = document.createElement("div");
    probe.className = "term-row";
    probe.style.visibility = "hidden";
    probe.style.position = "absolute";
    probe.textContent = "W";
    this._container.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    if (h > 0) {
      const rh = Math.ceil(h);
      this._rowHeight = rh;
      this.element.style.setProperty("--term-row-height", `${rh}px`);
    }
  }

  private _measureCharSize(): {
    charWidth: number;
    rowHeight: number;
  } | null {
    const row = document.createElement("div");
    row.className = "term-row";
    row.style.visibility = "hidden";
    row.style.position = "absolute";

    const probe = document.createElement("span");
    probe.textContent = "W";
    row.appendChild(probe);

    this._container.appendChild(row);
    const charWidth = probe.getBoundingClientRect().width;
    const rowHeight = row.getBoundingClientRect().height;
    row.remove();

    if (charWidth === 0 || rowHeight === 0) return null;
    this._rowHeight = rowHeight;
    return { charWidth, rowHeight };
  }

  private _setupResizeObserver(): void {
    const initial = this._measureCharSize();
    if (!initial) return;

    let { charWidth, rowHeight } = initial;

    this.resizeObserver = new ResizeObserver((entries) => {
      const measured = this._measureCharSize();
      if (measured) {
        charWidth = measured.charWidth;
        rowHeight = measured.rowHeight;
      }

      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const newCols = Math.max(1, Math.floor(width / charWidth));
        const newRows = Math.max(1, Math.floor(height / rowHeight));
        if (newCols !== this.cols || newRows !== this.rows) {
          this.resize(newCols, newRows);
        }
      }
    });
    this.resizeObserver.observe(this.element);
  }

  destroy(): void {
    this._destroyed = true;
    if (this._renderTimer != null) clearTimeout(this._renderTimer);
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.input) this.input.destroy();
    this.element.removeEventListener("click", this._onClickFocus);
    this.element.innerHTML = "";
    if (
      this.debug &&
      (globalThis as Record<string, unknown>).__wterm === this
    ) {
      delete (globalThis as Record<string, unknown>).__wterm;
    }
    this.debug = null;
  }
}
