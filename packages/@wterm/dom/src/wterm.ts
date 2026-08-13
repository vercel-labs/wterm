import { WasmBridge, type TerminalCore } from "@wterm/core";
import { Renderer } from "./renderer.js";
import { InputHandler } from "./input.js";
import { DebugAdapter } from "./debug.js";
import { isLinkActivationModifier } from "./hyperlink.js";

const SYNCHRONIZED_OUTPUT_TIMEOUT_MS = 1000;

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
  private _synchronizedOutputTimer: ReturnType<typeof setTimeout> | null = null;
  private _synchronizedOutputState: "idle" | "held" | "passthrough" = "idle";
  private _synchronizedOutputGeneration = 0;
  private _rendererNeedsSetup = false;
  private resizeObserver: ResizeObserver | null = null;
  private _destroyed = false;
  private _shouldScrollToBottom = false;
  private _scrollbackDiscardedCount = 0;
  private _programmaticScrollTop: number | null = null;
  private _pendingResizeScrollTop: number | null = null;
  private _rowHeight = 0;
  private _charWidth = 0;
  private _onClickFocus: (event: MouseEvent) => void;
  private _onScroll: () => void;
  private _onModifierChange: (event: KeyboardEvent) => void;
  private _onWindowBlur: () => void;

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

    this._onClickFocus = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".term-link")) {
        if (
          isLinkActivationModifier(
            event,
            this.element.ownerDocument.defaultView?.navigator ?? navigator,
          ) ||
          event.detail === 0
        ) {
          return;
        }
        event.preventDefault();
      }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) this.input?.focus();
    };
    this.element.addEventListener("click", this._onClickFocus);
    this._onModifierChange = (event) => {
      this.element.classList.toggle(
        "link-modifier-active",
        isLinkActivationModifier(
          event,
          this.element.ownerDocument.defaultView?.navigator ?? navigator,
        ),
      );
    };
    this._onWindowBlur = () => {
      this.element.classList.remove("link-modifier-active");
    };
    this.element.ownerDocument.addEventListener(
      "keydown",
      this._onModifierChange,
    );
    this.element.ownerDocument.addEventListener(
      "keyup",
      this._onModifierChange,
    );
    this.element.ownerDocument.defaultView?.addEventListener(
      "blur",
      this._onWindowBlur,
    );
    this._onScroll = () => {
      if (this._pendingResizeScrollTop !== null) return;
      if (
        this._programmaticScrollTop !== null &&
        this.element.scrollTop === this._programmaticScrollTop
      ) {
        this._programmaticScrollTop = null;
        return;
      }
      this._programmaticScrollTop = null;
      this._shouldScrollToBottom = false;
      this._scheduleRender();
    };
    this.element.addEventListener("scroll", this._onScroll, { passive: true });
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
      this._measureCharSize();

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
        () =>
          this._charWidth > 0 && this._rowHeight > 0
            ? { charWidth: this._charWidth, rowHeight: this._rowHeight }
            : null,
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
      this._setScrollTop(0);
      return;
    }
    this._setScrollTop(maxScroll);
  }

  private _setScrollTop(value: number): void {
    if (this.element.scrollTop === value) return;
    this._programmaticScrollTop = value;
    this.element.scrollTop = value;
  }

  write(data: string | Uint8Array): void {
    if (!this.bridge) return;
    if (this.debug) this.debug.traceWrite(data);
    this._shouldScrollToBottom = this._isScrolledToBottom();
    let deliveryError: unknown;
    let hasDeliveryError = false;
    const drain = () => {
      const result = this._drainResponses();
      if (!hasDeliveryError && result.hasError) {
        hasDeliveryError = true;
        deliveryError = result.error;
      }
    };
    if (typeof data === "string") {
      this.bridge.writeString(data, drain);
    } else {
      this.bridge.writeRaw(data, drain);
    }
    const synchronized = this.bridge.synchronizedOutput?.() ?? false;
    const generation = this.bridge.synchronizedOutputGeneration?.() ?? 0;
    this._updateSynchronizedOutput(synchronized, generation);
    if (this._synchronizedOutputState !== "held") {
      this._setupRendererIfNeeded();
      this._scheduleRender();
    }
    drain();
    if (hasDeliveryError) throw deliveryError;
  }

  resize(cols: number, rows: number): void {
    if (!this.bridge) return;
    this._shouldScrollToBottom =
      this._pendingResizeScrollTop === null && this._isScrolledToBottom();
    this.cols = cols;
    this.rows = rows;
    this.bridge.resize(cols, rows);
    const synchronized = this.bridge.synchronizedOutput?.() ?? false;
    const generation = this.bridge.synchronizedOutputGeneration?.() ?? 0;
    if (this._updateSynchronizedOutput(synchronized, generation)) {
      this._rendererNeedsSetup = true;
    } else {
      this._setupRenderer(cols, rows);
      this._scheduleRender();
    }
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
    if (this.rafId != null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this._doRender();
    });
  }

  private _cancelScheduledRender(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private _updateSynchronizedOutput(
    synchronized: boolean,
    generation: number,
  ): boolean {
    if (!synchronized) {
      if (this._synchronizedOutputState === "held") {
        this._cancelSynchronizedOutputFallback();
      }
      this._synchronizedOutputState = "idle";
      return false;
    }
    if (
      this._synchronizedOutputState === "held" &&
      generation !== this._synchronizedOutputGeneration
    ) {
      this._armSynchronizedOutputFallback(generation);
      return true;
    } else if (
      this._synchronizedOutputState === "passthrough" &&
      generation !== this._synchronizedOutputGeneration
    ) {
      this._synchronizedOutputState = "idle";
    }
    if (this._synchronizedOutputState !== "idle") {
      return this._synchronizedOutputState === "held";
    }
    this._synchronizedOutputState = "held";
    this._cancelScheduledRender();
    this._armSynchronizedOutputFallback(generation);
    return true;
  }

  private _armSynchronizedOutputFallback(generation: number): void {
    this._cancelSynchronizedOutputFallback();
    this._synchronizedOutputGeneration = generation;
    this._synchronizedOutputTimer = setTimeout(() => {
      if (
        this._synchronizedOutputState !== "held" ||
        this._synchronizedOutputGeneration !== generation
      ) {
        return;
      }
      this._synchronizedOutputTimer = null;
      this._synchronizedOutputState = "passthrough";
      this._setupRendererIfNeeded();
      this._cancelScheduledRender();
      this._doRender();
    }, SYNCHRONIZED_OUTPUT_TIMEOUT_MS);
  }

  private _cancelSynchronizedOutputFallback(): void {
    if (this._synchronizedOutputTimer == null) return;
    clearTimeout(this._synchronizedOutputTimer);
    this._synchronizedOutputTimer = null;
  }

  private _setupRendererIfNeeded(): void {
    if (!this._rendererNeedsSetup) return;
    this._setupRenderer(this.cols, this.rows);
    this._rendererNeedsSetup = false;
  }

  private _setupRenderer(cols: number, rows: number): void {
    if (!this._shouldScrollToBottom && this._pendingResizeScrollTop === null) {
      this._pendingResizeScrollTop = this.element.scrollTop;
    }
    this.renderer?.setup(cols, rows);
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

    const rowHeight = this._rowHeight || 17;
    const scrollbackCount = this.bridge.getScrollbackCount();
    const discardedCount = this.bridge.getScrollbackDiscardedCount?.();
    const discardedDelta =
      discardedCount !== undefined &&
      discardedCount >= this._scrollbackDiscardedCount
        ? discardedCount - this._scrollbackDiscardedCount
        : 0;
    if (discardedCount !== undefined) {
      this._scrollbackDiscardedCount = discardedCount;
    }
    let scrollTop =
      this._pendingResizeScrollTop !== null
        ? this._pendingResizeScrollTop
        : this.element.scrollTop;
    if (!this._shouldScrollToBottom && discardedDelta > 0) {
      scrollTop = Math.max(0, scrollTop - discardedDelta * rowHeight);
      if (this._pendingResizeScrollTop !== null) {
        this._pendingResizeScrollTop = scrollTop;
      } else {
        this._setScrollTop(scrollTop);
      }
    }

    this.renderer.render(this.bridge, {
      scrollTop: this._shouldScrollToBottom
        ? Math.max(
            0,
            (scrollbackCount + this.rows) * rowHeight -
              this.element.clientHeight,
          )
        : scrollTop,
      clientHeight: this.element.clientHeight,
      rowHeight,
      scrollbackDiscardedCount: discardedCount,
    });

    if (this.debug) {
      this.debug.recordRender(performance.now() - t0, dirtyCount);
    }

    const hasScrollback = scrollbackCount > 0;
    this.element.classList.toggle("has-scrollback", hasScrollback);

    if (this._shouldScrollToBottom) {
      this._scrollToBottom();
    } else if (this._pendingResizeScrollTop !== null) {
      const pendingScrollTop = this._pendingResizeScrollTop;
      this._pendingResizeScrollTop = null;
      this._setScrollTop(pendingScrollTop);
    } else if (!hasScrollback && this.element.scrollTop !== 0) {
      this.element.scrollTop = 0;
    }

    const title = this.bridge.getTitle();
    if (title !== null && this.onTitle) {
      this.onTitle(title);
    }

    this._drainResponses();
  }

  private _drainResponses(): { hasError: boolean; error?: unknown } {
    if (!this.bridge) return { hasError: false };
    let response: string | null;
    let firstError: unknown;
    let hasError = false;
    while ((response = this.bridge.getResponse()) !== null) {
      try {
        if (this.onData) this.onData(response);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      }
    }
    return { hasError, error: firstError };
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
    this._charWidth = charWidth;
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
    this._cancelScheduledRender();
    this._cancelSynchronizedOutputFallback();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.input) this.input.destroy();
    this.element.removeEventListener("click", this._onClickFocus);
    this.element.removeEventListener("scroll", this._onScroll);
    this.element.ownerDocument.removeEventListener(
      "keydown",
      this._onModifierChange,
    );
    this.element.ownerDocument.removeEventListener(
      "keyup",
      this._onModifierChange,
    );
    this.element.ownerDocument.defaultView?.removeEventListener(
      "blur",
      this._onWindowBlur,
    );
    this.element.classList.remove("link-modifier-active");
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
