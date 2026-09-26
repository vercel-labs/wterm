import {
  WasmBridge,
  type TerminalCore,
  type TerminalPosition,
} from "@wterm/core";
import { Renderer } from "./renderer.js";
import { InputHandler } from "./input.js";
import { HistorySelection } from "./history-selection.js";
import { TextCapture } from "./text-capture.js";
import { OutputAnnouncements } from "./output-announcements.js";
import { DebugAdapter } from "./debug.js";
import { isLinkActivationModifier } from "./hyperlink.js";
import {
  SearchController,
  type SearchOptions,
  type SearchState,
} from "./search.js";

const SYNCHRONIZED_OUTPUT_TIMEOUT_MS = 1000;
const PROGRAMMATIC_SCROLL_TOLERANCE = 1;

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
  /** Maximum rendered Kitty image width in CSS pixels. */
  maxImageWidth?: number;
  /** Maximum rendered Kitty image height in CSS pixels. */
  maxImageHeight?: number;
  /** Force blinking on/off; omit to follow the terminal application's request. */
  cursorBlink?: boolean;
  /** Announce changed terminal text politely while input has focus. Off by default. */
  announceOutput?: boolean;
  /** Suspend painting for an inactive pane while continuing to parse output. */
  renderingPaused?: boolean;
  debug?: boolean;
  onData?: (data: string) => void;
  /** Raw input bytes, used by X10 mouse reports. */
  onBinary?: (data: Uint8Array) => void;
  onTitle?: (title: string) => void;
  /** Called with the number of BEL controls since the last delivery. */
  onBell?: (count: number) => void;
  onResize?: (cols: number, rows: number) => void;
  onSearchChange?: (state: SearchState) => void;
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
  private maxImageWidth: number | undefined;
  private maxImageHeight: number | undefined;
  private _debugEnabled: boolean;
  private renderer: Renderer | null = null;
  private input: InputHandler | null = null;
  private rafId: number | null = null;
  private _renderingPaused: boolean;
  private _onVisibilityChange: () => void;
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
  private _windowSizeQueryState: 0 | 1 | 2 | 3 | 4 | 6 = 0;
  private _search: SearchController;
  private _historySelection: HistorySelection;
  private _textCapture = new TextCapture();
  private _outputAnnouncements: OutputAnnouncements;
  private _searchReveal = false;
  private _onClickFocus: (event: MouseEvent) => void;
  private _onScroll: () => void;
  private _onModifierChange: (event: KeyboardEvent) => void;
  private _onWindowBlur: () => void;
  private _onCopy: (event: ClipboardEvent) => void;
  private _onMouseSelect: (event: MouseEvent) => void;

  onData: ((data: string) => void) | null;
  onBinary: ((data: Uint8Array) => void) | null;
  onTitle: ((title: string) => void) | null;
  onBell: ((count: number) => void) | null;
  onResize: ((cols: number, rows: number) => void) | null;
  onSearchChange: ((state: SearchState) => void) | null;

  private _container: HTMLDivElement;

  constructor(element: HTMLElement, options: WTermOptions = {}) {
    this.element = element;
    this._coreOption = options.core;
    this.wasmUrl = options.wasmUrl;
    this.maxImageWidth = options.maxImageWidth;
    this.maxImageHeight = options.maxImageHeight;
    this.cols = options.cols || 80;
    this.rows = options.rows || 24;
    this.autoResize = options.autoResize !== false;
    this._debugEnabled = options.debug ?? false;
    this._renderingPaused = options.renderingPaused ?? false;

    this.onData = options.onData || null;
    this.onBinary = options.onBinary || null;
    this.onTitle = options.onTitle || null;
    this.onBell = options.onBell || null;
    this.onResize = options.onResize || null;
    this.onSearchChange = options.onSearchChange || null;
    this._search = new SearchController((reveal) => {
      this._searchReveal ||= reveal;
      if (reveal) {
        const match = this._search.matches[this.getSearchState().activeIndex];
        if (match) {
          this._shouldScrollToBottom = false;
          this._pendingResizeScrollTop = null;
          this._setScrollTop(
            (match.start.row + 0.5) * this._rowHeight -
              this.element.clientHeight / 2,
          );
        }
      }
      if (this._synchronizedOutputState !== "held") this._scheduleRender();
      this.onSearchChange?.(this.getSearchState());
    });

    this._container = document.createElement("div");
    this._container.className = "term-grid";
    this.element.appendChild(this._container);
    this.element.classList.add("wterm");
    this._historySelection = new HistorySelection(this.element);
    this._outputAnnouncements = new OutputAnnouncements(
      this.element,
      () => this.bridge,
      () =>
        this._canRender() &&
        this.rafId === null &&
        this._synchronizedOutputState !== "held",
    );
    this._outputAnnouncements.setEnabled(options.announceOutput ?? false);
    this._onVisibilityChange = () => {
      if (this._canRender()) this._scheduleRender();
      else {
        this._cancelScheduledRender();
        this._outputAnnouncements.invalidate();
      }
    };
    this.element.ownerDocument.addEventListener(
      "visibilitychange",
      this._onVisibilityChange,
    );
    this.element.classList.toggle("cursor-blink", options.cursorBlink === true);
    this.element.classList.toggle(
      "cursor-steady",
      options.cursorBlink === false,
    );

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
    this._onMouseSelect = (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        (event.detail !== 2 && event.detail !== 3) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !(event.target instanceof Element)
      )
        return;
      const position = this.renderer?.positionAt(
        event.target,
        event.clientX,
        this._charWidth,
      );
      if (!position || !this.bridge) return;
      if (
        !event.shiftKey &&
        this.bridge.mouseTracking?.() &&
        position.row >= this.bridge.getScrollbackCount()
      )
        return;
      const selected =
        event.detail === 2
          ? this.selectWord(position)
          : this.selectLine(position.row);
      if (selected) event.preventDefault();
    };
    // Expand after native mouse selection finishes. Cancelling mousedown
    // leaves Chromium/WebKit's previous selection gesture active, which can
    // collapse a replacement range on mouseup. Run before click-to-focus.
    this.element.addEventListener("click", this._onMouseSelect);
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
      if (this._shouldScrollToBottom && this._isScrolledToBottom()) {
        this._programmaticScrollTop = null;
        return;
      }
      if (
        this._programmaticScrollTop !== null &&
        Math.abs(this.element.scrollTop - this._programmaticScrollTop) <=
          PROGRAMMATIC_SCROLL_TOLERANCE
      ) {
        this._programmaticScrollTop = null;
        return;
      }
      this._programmaticScrollTop = null;
      this._shouldScrollToBottom = false;
      this._scheduleRender();
    };
    this.element.addEventListener("scroll", this._onScroll, { passive: true });
    this._onCopy = (event) => {
      if (event.defaultPrevented || !event.clipboardData) return;
      const target = event.target;
      if (
        target instanceof Element &&
        !this.element.contains(target) &&
        (target.closest("input, textarea") ||
          (target as HTMLElement).isContentEditable)
      )
        return;
      const text = this.getSelectionText();
      // A pending full-history snapshot must never fall back to a partial copy.
      if (this._historySelection.pending) {
        event.preventDefault();
        return;
      }
      if (text === null) return;
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
    };
    this.element.ownerDocument.addEventListener("copy", this._onCopy);
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
      this.cols = this.bridge.getCols();
      this.rows = this.bridge.getRows();

      if (this._debugEnabled) {
        this.debug = new DebugAdapter();
        this.debug.setBridge(this.bridge);
        (globalThis as Record<string, unknown>).__wterm = this;
      }

      this._setRowHeight();
      this._measureCharSize();

      this.renderer = new Renderer(this._container, {
        colorHost: this.element,
        maxImageWidth: this.maxImageWidth,
        maxImageHeight: this.maxImageHeight,
      });
      this.renderer.setup(this.cols, this.rows);

      this.input = new InputHandler(
        this.element,
        (data) => {
          this._outputAnnouncements.input();
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
        () => {
          this._historySelection.clear();
          this._scrollToBottom();
        },
        (data) => {
          this._outputAnnouncements.input();
          this._historySelection.clear();
          this._scrollToBottom();
          if (this.onBinary) {
            this.onBinary(data);
          } else if (!this.onData) {
            this.write(data);
          } else if (data.every((byte) => byte < 128)) {
            this.onData(String.fromCharCode(...data));
          }
        },
        {
          selectAll: () => {
            void this.selectAll();
          },
          hasSelection: () => this._historySelection.active,
          clearSelection: () => this._historySelection.clear(),
        },
      );

      this._setupResizeObserver();
      if (!this.autoResize) {
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
    this._setScrollTop(this.element.scrollHeight);
  }

  private _setScrollTop(value: number): void {
    const before = this.element.scrollTop;
    this.element.scrollTop = value;
    const after = this.element.scrollTop;
    if (after === before) return;
    this._programmaticScrollTop = after;
  }

  write(data: string | Uint8Array): void {
    if (!this.bridge || this._destroyed) return;
    this._textCapture.cancel();
    this._historySelection.invalidate();
    this.renderer?.beforeMutation(this.bridge);
    if (this.debug) this.debug.traceWrite(data);
    this._shouldScrollToBottom = this._isScrolledToBottom();
    const windowSizeQueries = this._collectWindowSizeQueries(data);
    let deliveryError: unknown;
    let hasDeliveryError = false;
    const recordDeliveryError = (error: unknown) => {
      if (hasDeliveryError) return;
      hasDeliveryError = true;
      deliveryError = error;
    };
    const drain = () => {
      const result = this._drainResponses();
      if (result.hasError) recordDeliveryError(result.error);
      const bells = this.bridge?.getBellCount?.() ?? 0;
      if (bells > 0) {
        try {
          this.onBell?.(bells);
        } catch (error) {
          recordDeliveryError(error);
        }
      }
      // Titles, like replies and bells, must reach the host even without paint.
      try {
        this._deliverTitle();
      } catch (error) {
        recordDeliveryError(error);
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
    this._invalidateSearch();
    if (this._synchronizedOutputState !== "held") {
      this._setupRendererIfNeeded();
      this._scheduleRender();
    }
    drain();
    for (const query of windowSizeQueries) {
      try {
        this.onData?.(this._windowSizeResponse(query));
      } catch (error) {
        recordDeliveryError(error);
      }
    }
    if (hasDeliveryError) throw deliveryError;
  }

  resize(cols: number, rows: number): void {
    if (!this.bridge || this._destroyed) return;
    this._textCapture.cancel();
    this._historySelection.invalidate();
    this.renderer?.beforeMutation(this.bridge);
    this._shouldScrollToBottom =
      this._pendingResizeScrollTop === null && this._isScrolledToBottom();
    this.bridge.resize(cols, rows);
    this._outputAnnouncements.invalidate();
    this.cols = this.bridge.getCols();
    this.rows = this.bridge.getRows();
    const synchronized = this.bridge.synchronizedOutput?.() ?? false;
    const generation = this.bridge.synchronizedOutputGeneration?.() ?? 0;
    if (this._updateSynchronizedOutput(synchronized, generation)) {
      this._rendererNeedsSetup = true;
    } else {
      this._setupRenderer();
      this._scheduleRender();
    }
    this._invalidateSearch();
    if (this.onResize) this.onResize(this.cols, this.rows);
  }

  /** Search retained history and the active screen, using plain text. */
  search(query: string, options: SearchOptions = {}): void {
    if (this._destroyed) return;
    this._search.search(query, options);
    this._paintSearch();
  }

  findNext(): boolean {
    return !this._destroyed && this._search.navigate(1);
  }
  findPrevious(): boolean {
    return !this._destroyed && this._search.navigate(-1);
  }
  clearSearch(): void {
    this.search("");
  }
  getSearchState(): SearchState {
    return this._search.snapshot();
  }

  /** Enable or stop polite announcements without changing terminal focus. */
  setOutputAnnouncements(enabled: boolean): void {
    if (!this._destroyed) this._outputAnnouncements.setEnabled(enabled);
  }

  /** Pause pane painting without buffering output or stopping terminal effects. */
  setRenderingPaused(paused: boolean): void {
    if (this._destroyed || paused === this._renderingPaused) return;
    this._renderingPaused = paused;
    this._onVisibilityChange();
  }

  private _canRender(): boolean {
    return (
      !this._destroyed &&
      !this._renderingPaused &&
      this.element.ownerDocument.visibilityState !== "hidden"
    );
  }

  /** Capture retained history and the active screen without changing selection. */
  readText(options: { signal?: AbortSignal } = {}): Promise<string> {
    if (this._destroyed || !this.renderer || !this.bridge)
      return Promise.reject(new Error("Terminal is not initialized"));
    const captured = this._textCapture.read(options.signal);
    this._scheduleRender();
    return captured;
  }

  /** Read the terminal selection with terminal line and cell semantics. */
  getSelectionText(): string | null {
    if (this._destroyed) return null;
    return (
      this._historySelection.getText() ??
      this.renderer?.getSelectionText() ??
      null
    );
  }

  /** Select retained history and the active screen without mounting extra rows. */
  selectAll(): Promise<boolean> {
    if (this._destroyed || !this.renderer || !this.bridge)
      return Promise.resolve(false);
    const selected = this._historySelection.select();
    this._scheduleRender();
    return selected;
  }

  /** Select a word at a cell, with row zero at the oldest retained row. */
  selectWord(position: TerminalPosition): boolean {
    return this._selectUnit(position, "word");
  }

  /** Select the logical line containing a retained-buffer row. */
  selectLine(row: number): boolean {
    return this._selectUnit({ row, col: 0 }, "line");
  }

  private _selectUnit(
    position: TerminalPosition,
    unit: "word" | "line",
  ): boolean {
    if (this._destroyed || !this.bridge || !this.renderer) return false;
    return this.renderer.select(this.bridge, position, unit, () => {
      this._historySelection.clear();
      const active = this.element.ownerDocument.activeElement;
      if (
        active instanceof HTMLElement &&
        this.element.contains(active) &&
        active.tagName === "TEXTAREA"
      )
        active.blur();
    });
  }

  /** Cancel Select All and clear a native selection wholly owned by this terminal. */
  clearSelection(): void {
    this._historySelection.clear();
    const selection = this.element.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed) return;
    for (let index = 0; index < selection.rangeCount; index++) {
      const range = selection.getRangeAt(index);
      if (
        !this.element.contains(range.startContainer) ||
        !this.element.contains(range.endContainer)
      )
        return;
    }
    selection.removeAllRanges();
  }

  private _invalidateSearch(): void {
    if (!this.getSearchState().query) return;
    this._searchReveal = false;
    this._search.invalidate();
    this._paintSearch();
  }

  private _paintSearch(): void {
    if (!this.renderer || !this.bridge || !this._canRender()) return;
    const fragment = document.createDocumentFragment();
    const matches = this._search.matches;
    if (!matches.length) {
      this.renderer.setSearchDecorations(fragment);
      return;
    }
    const active = this.getSearchState().activeIndex;
    const viewport = this.element.getBoundingClientRect();
    for (const { row, element } of this.renderer.searchRows()) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
      // Match ends are ordered, so offscreen history does not add paint work.
      let low = 0,
        high = matches.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (matches[mid].end.row < row) low = mid + 1;
        else high = mid;
      }
      const history = this.bridge.getScrollbackCount();
      const offset = history - row - 1;
      let cols =
        row < history ? this.bridge.getScrollbackLineLen(offset) : this.cols;
      if (cols <= 0) continue;
      const last =
        row < history
          ? this.bridge.getScrollbackCell(offset, cols - 1)
          : this.bridge.getCell(row - history, cols - 1);
      if (last.spacerHead) cols--;
      let rangeStart = -1,
        rangeEnd = -1;
      const draw = (start: number, end: number, selected: boolean) => {
        if (end <= start) return;
        const mark = document.createElement("div");
        mark.className = `term-search-match${selected ? " term-search-active" : ""}`;
        mark.style.cssText = `left:${start * this._charWidth}px;top:${element.offsetTop}px;width:${(end - start) * this._charWidth}px;height:${rect.height}px`;
        fragment.appendChild(mark);
      };
      for (
        let i = low;
        i < matches.length && matches[i].start.row <= row;
        i++
      ) {
        const match = matches[i];
        const start = match.start.row === row ? match.start.col : 0;
        const end = Math.min(
          cols,
          match.end.row === row ? match.end.endCol : cols,
        );
        if (rangeStart >= 0 && start > rangeEnd) {
          draw(rangeStart, rangeEnd, false);
          rangeStart = -1;
        }
        if (rangeStart < 0) rangeStart = start;
        rangeEnd = Math.max(rangeEnd, end);
      }
      if (rangeStart >= 0) draw(rangeStart, rangeEnd, false);
      const selected = matches[active];
      if (selected && selected.start.row <= row && selected.end.row >= row) {
        draw(
          selected.start.row === row ? selected.start.col : 0,
          Math.min(cols, selected.end.row === row ? selected.end.endCol : cols),
          true,
        );
      }
    }
    this.renderer.setSearchDecorations(fragment);
  }

  focus(): void {
    if (this.input) {
      this.input.focus();
    } else {
      this.element.focus();
    }
  }

  private _scheduleRender(): void {
    if (
      !this._canRender() ||
      this._synchronizedOutputState === "held" ||
      this.rafId != null
    )
      return;
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
    this._setupRenderer();
    this._rendererNeedsSetup = false;
  }

  private _setupRenderer(): void {
    if (!this._shouldScrollToBottom && this._pendingResizeScrollTop === null) {
      this._pendingResizeScrollTop = this.element.scrollTop;
    }
    this.renderer?.requestSetup();
  }

  private _initialRender(): void {
    this._doRender();
  }

  private _doRender(): void {
    if (
      !this._canRender() ||
      !this.bridge ||
      !this.renderer ||
      this._synchronizedOutputState === "held"
    )
      return;

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
      charWidth: this._charWidth,
    });

    if (this.debug) {
      this.debug.recordRender(performance.now() - t0, dirtyCount);
    }

    const hasScrollback = scrollbackCount > 0 || this.renderer.hasImageFlow;
    this.element.classList.toggle("has-scrollback", hasScrollback);

    if (this._shouldScrollToBottom) {
      this._scrollToBottom();
    } else if (this._pendingResizeScrollTop !== null) {
      const pendingScrollTop = this._pendingResizeScrollTop;
      this._pendingResizeScrollTop = null;
      this._setScrollTop(pendingScrollTop);
    } else if (!hasScrollback && this.element.scrollTop !== 0) {
      this._setScrollTop(0);
    }

    this.input?.syncInputPosition();
    if (this._searchReveal) {
      this._searchReveal = false;
      const match = this._search.matches[this.getSearchState().activeIndex];
      const target =
        match &&
        Array.from(this.renderer.searchRows()).find(
          ({ row }) => row === match.start.row,
        );
      if (target) {
        const rect = target.element.getBoundingClientRect();
        const viewport = this.element.getBoundingClientRect();
        this._setScrollTop(
          this.element.scrollTop +
            rect.top -
            viewport.top -
            (this.element.clientHeight - rect.height) / 2,
        );
      }
    }
    this._paintSearch();
    this._search.resume(this.bridge);
    this._historySelection.resume(this.bridge);
    this._textCapture.resume(this.bridge);
    this._outputAnnouncements.rendered();

    this._deliverTitle();

    this._drainResponses();
  }

  private _deliverTitle(): void {
    const title = this.bridge?.getTitle() ?? null;
    if (title !== null) this.onTitle?.(title);
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

  /**
   * Kitty uses xterm window reports to discover the pixel geometry needed for
   * image placement. The core intentionally does not know about the browser
   * viewport, so these two queries are answered at the DOM boundary.
   */
  private _collectWindowSizeQueries(data: string | Uint8Array): (14 | 16)[] {
    const queries: (14 | 16)[] = [];
    let state = this._windowSizeQueryState;
    let index = 0;
    while (index < data.length) {
      if (state === 0) {
        // Skip ordinary output in bulk. ASCII queries can be recognized in
        // raw bytes without allocating or decoding a copy of every write.
        index =
          typeof data === "string"
            ? data.indexOf("\x1b", index)
            : data.indexOf(0x1b, index);
        if (index < 0) break;
        state = 1;
        index++;
        continue;
      }
      const code =
        typeof data === "string" ? data.charCodeAt(index) : data[index];
      index++;
      const restart = code === 0x1b ? 1 : 0;
      switch (state) {
        case 1: // ESC
          state = code === 0x5b ? 2 : restart;
          break;
        case 2: // ESC [
          state = code === 0x31 ? 3 : restart;
          break;
        case 3: // ESC [ 1
          state = code === 0x34 ? 4 : code === 0x36 ? 6 : restart;
          break;
        case 4:
        case 6:
          if (code === 0x74) queries.push(state === 4 ? 14 : 16);
          state = restart;
          break;
      }
    }
    // Only the matched ASCII prefix survives, including across mixed writes.
    this._windowSizeQueryState = state;
    return queries;
  }

  private _windowSizeResponse(query: 14 | 16): string {
    const { width, height } = this._pixelSize();
    if (query === 14) {
      return `\x1b[4;${height};${width}t`;
    }
    const cellWidth = Math.max(1, Math.round(this._charWidth));
    const cellHeight = Math.max(1, Math.round(this._rowHeight));
    return `\x1b[6;${cellHeight};${cellWidth}t`;
  }

  private _pixelSize(): { width: number; height: number } {
    const style = getComputedStyle(this.element);
    const horizontalPadding =
      (parseFloat(style.paddingLeft) || 0) +
      (parseFloat(style.paddingRight) || 0);
    const verticalPadding =
      (parseFloat(style.paddingTop) || 0) +
      (parseFloat(style.paddingBottom) || 0);

    let width = this.element.clientWidth - horizontalPadding;
    let height = this.element.clientHeight - verticalPadding;
    if (width <= 0 || height <= 0) {
      const rect = this.element.getBoundingClientRect();
      width = rect.width - horizontalPadding;
      height = rect.height - verticalPadding;
    }

    // A hidden element has no layout box. The measured cell geometry still
    // gives Kitty a useful answer while the terminal is being mounted.
    if (width <= 0 && this._charWidth > 0) width = this.cols * this._charWidth;
    if (height <= 0 && this._rowHeight > 0)
      height = this.rows * this._rowHeight;

    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
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
    // Measure the font itself, not the cell width from an earlier measurement.
    probe.style.width = "auto";
    probe.textContent = "W";
    row.appendChild(probe);

    this._container.appendChild(row);
    const charWidth = probe.getBoundingClientRect().width;
    const rowHeight = row.getBoundingClientRect().height;
    row.remove();

    if (charWidth === 0 || rowHeight === 0) return null;
    this._charWidth = charWidth;
    this._rowHeight = rowHeight;
    this.element.style.setProperty("--term-cell-width", `${charWidth}px`);
    return { charWidth, rowHeight };
  }

  private _setupResizeObserver(): void {
    // This probe survives grid rebuilds and changes size when a web font loads
    // or the host changes typography, even if the container stays the same size.
    const probe = document.createElement("span");
    probe.className = "term-size-probe";
    probe.setAttribute("aria-hidden", "true");
    probe.textContent = "W";
    this.element.appendChild(probe);
    let containerRect: DOMRectReadOnly | undefined;

    this.resizeObserver = new ResizeObserver((entries) => {
      if (this._destroyed) return;
      for (const entry of entries) {
        if (entry.target === this.element) containerRect = entry.contentRect;
      }
      const measured = this._measureCharSize();
      if (!measured || !this.autoResize || !containerRect) return;

      const { charWidth, rowHeight } = measured;
      const newCols = Math.max(1, Math.floor(containerRect.width / charWidth));
      const newRows = Math.max(1, Math.floor(containerRect.height / rowHeight));
      if (newCols !== this.cols || newRows !== this.rows) {
        this.resize(newCols, newRows);
      }
    });
    this.resizeObserver.observe(probe);
    if (this.autoResize) this.resizeObserver.observe(this.element);
  }

  destroy(): void {
    this._destroyed = true;
    this._textCapture.cancel();
    this._historySelection.destroy();
    this._outputAnnouncements.destroy();
    this._search.cancel();
    this.onSearchChange = null;
    this._windowSizeQueryState = 0;
    this._cancelScheduledRender();
    this._cancelSynchronizedOutputFallback();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.input) this.input.destroy();
    this.renderer?.destroy();
    this.renderer = null;
    this.element.removeEventListener("click", this._onClickFocus);
    this.element.removeEventListener("click", this._onMouseSelect);
    this.element.removeEventListener("scroll", this._onScroll);
    this.element.ownerDocument.removeEventListener("copy", this._onCopy);
    this.element.ownerDocument.removeEventListener(
      "visibilitychange",
      this._onVisibilityChange,
    );
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
