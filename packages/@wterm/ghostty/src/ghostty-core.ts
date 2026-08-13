import type {
  CellData,
  CursorState,
  UnhandledSequence,
  TerminalCore,
} from "@wterm/core";
import {
  type GhosttyWasm,
  loadGhosttyWasm,
  parseCell,
  writeString as wasmWriteString,
  writeBytes as wasmWriteBytes,
  allocBuffer,
  freeBuffer,
  CELL_BYTES,
} from "./wasm-bindings.js";

const DEFAULT_COLOR = 256;
const GRAPHEME_BUFFER_BYTES = 256;
const HYPERLINK_BUFFER_BYTES = 1024;
const DEFAULT_FOREGROUND = "#d4d4d4";
const DEFAULT_BACKGROUND = "#1e1e1e";

const WTERM_FLAG_BOLD = 0x01;
const WTERM_FLAG_DIM = 0x02;
const WTERM_FLAG_ITALIC = 0x04;
const WTERM_FLAG_UNDERLINE = 0x08;
const WTERM_FLAG_BLINK = 0x10;
const WTERM_FLAG_REVERSE = 0x20;
const WTERM_FLAG_INVISIBLE = 0x40;
const WTERM_FLAG_STRIKETHROUGH = 0x80;

// Our WASM layer packs flags in the same order as wterm (see wasm_api.zig):
//   bold=1, faint=2, italic=4, underline=8, blink=16, inverse=32,
//   invisible=64, strikethrough=128
// This matches wterm's layout exactly, so no remapping is needed.
const _FLAG_SANITY_CHECK = [
  WTERM_FLAG_BOLD,
  WTERM_FLAG_DIM,
  WTERM_FLAG_ITALIC,
  WTERM_FLAG_UNDERLINE,
  WTERM_FLAG_BLINK,
  WTERM_FLAG_REVERSE,
  WTERM_FLAG_INVISIBLE,
  WTERM_FLAG_STRIKETHROUGH,
];
void _FLAG_SANITY_CHECK;

function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

const BLANK_CELL: CellData = {
  char: 32,
  fg: DEFAULT_COLOR,
  bg: DEFAULT_COLOR,
  flags: 0,
  width: 1,
};

export interface GhosttyOptions {
  wasmPath?: string;
  scrollbackLimit?: number;
  foregroundColor?: string;
  backgroundColor?: string;
}

function parseColor(value: string, option: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`@wterm/ghostty: ${option} must be a #RRGGBB color`);
  }
  return Number.parseInt(value.slice(1), 16);
}

/**
 * Terminal core powered by libghostty built from source. Implements the
 * same `TerminalCore` interface as wterm's built-in Zig core, providing
 * full-featured VT emulation including proper Unicode grapheme handling,
 * all SGR attributes, terminal modes, and more.
 *
 * @example
 * ```ts
 * import { WTerm } from '@wterm/dom';
 * import { GhosttyCore } from '@wterm/ghostty';
 *
 * const core = await GhosttyCore.load();
 * const term = new WTerm(el, { core });
 * await term.init();
 * ```
 */
export class GhosttyCore implements TerminalCore {
  private wasm: GhosttyWasm;
  private termPtr = 0;
  private _options: GhosttyOptions;
  private _foregroundRgb: number;
  private _backgroundRgb: number;

  private _viewportBufPtr = 0;
  private _viewportBufSize = 0;
  private _viewportView: DataView | null = null;
  private _viewportStale = true;
  private _cols = 0;
  private _rows = 0;

  // One decoded scrollback row, reused across the per-column reads the
  // renderer does for that row.
  private _scrollbackBufPtr = 0;
  private _scrollbackBufSize = 0;
  private _scrollbackView: DataView | null = null;
  private _scrollbackOffset = -1;
  private _scrollbackLen = 0;
  private _graphemeBufPtr = 0;
  private _graphemeBufSize = GRAPHEME_BUFFER_BYTES;
  private _hyperlinkBufPtr = 0;
  private _hyperlinkBufSize = HYPERLINK_BUFFER_BYTES;

  private constructor(wasm: GhosttyWasm, options: GhosttyOptions) {
    this.wasm = wasm;
    this._options = options;
    this._foregroundRgb = parseColor(
      options.foregroundColor ?? DEFAULT_FOREGROUND,
      "foregroundColor",
    );
    this._backgroundRgb = parseColor(
      options.backgroundColor ?? DEFAULT_BACKGROUND,
      "backgroundColor",
    );
  }

  /**
   * Load the ghostty-vt WASM binary and create a new `GhosttyCore`.
   * The returned core is ready to be passed as the `core` option to `WTerm`.
   */
  static async load(options: GhosttyOptions = {}): Promise<GhosttyCore> {
    const wasm = await loadGhosttyWasm(options.wasmPath);
    return new GhosttyCore(wasm, options);
  }

  // -- Lifecycle --

  init(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    const scrollback = this._options.scrollbackLimit ?? 10000;
    this.termPtr = this.wasm.exports.init(
      cols,
      rows,
      scrollback,
      this._foregroundRgb,
      this._backgroundRgb,
    );
    this._graphemeBufPtr = allocBuffer(this.wasm, GRAPHEME_BUFFER_BYTES);
    if (this._hyperlinkBufPtr !== 0) {
      freeBuffer(this.wasm, this._hyperlinkBufPtr, this._hyperlinkBufSize);
    }
    this._hyperlinkBufSize = HYPERLINK_BUFFER_BYTES;
    this._hyperlinkBufPtr = allocBuffer(this.wasm, HYPERLINK_BUFFER_BYTES);
    this._allocViewportBuffer();
    this._invalidate();
  }

  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.wasm.exports.resize(this.termPtr, cols, rows);
    this._allocViewportBuffer();
    this._invalidate();
  }

  // -- I/O --

  writeString(str: string): void {
    wasmWriteString(this.wasm, this.termPtr, str);
    this._invalidate();
  }

  writeRaw(data: Uint8Array): void {
    wasmWriteBytes(this.wasm, this.termPtr, data);
    this._invalidate();
  }

  // -- Grid --

  getCell(row: number, col: number): CellData {
    this._ensureViewport();
    const view = this._viewportView;
    if (!view) return BLANK_CELL;

    const idx = row * this._cols + col;
    const byteOffset = idx * CELL_BYTES;
    if (byteOffset + CELL_BYTES > this._viewportBufSize) return BLANK_CELL;

    const cell = parseCell(view, byteOffset);
    // A continuation cell carries no content of its own, so the blank test
    // matches it. Returning BLANK_CELL would hide the width the renderer
    // needs to skip it.
    if (
      cell.codepoint === 0 &&
      cell.flags === 0 &&
      cell.colorFlags === 0 &&
      !cell.hasHyperlink &&
      cell.width !== 0
    )
      return BLANK_CELL;

    const result: CellData = {
      char: cell.codepoint || 32,
      fg: DEFAULT_COLOR,
      bg: DEFAULT_COLOR,
      flags: cell.flags,
      width: cell.width,
    };
    if (cell.hasGrapheme) result.chars = this._readGrapheme(row, col);
    if (cell.hasHyperlink)
      Object.assign(result, this._readHyperlink(row, col, false));
    if (cell.colorFlags & 1)
      result.fgRgb = packRgb(cell.fgR, cell.fgG, cell.fgB);
    if (cell.colorFlags & 2)
      result.bgRgb = packRgb(cell.bgR, cell.bgG, cell.bgB);
    return result;
  }

  isDirtyRow(row: number): boolean {
    this._ensureViewport();
    return this.wasm.exports.is_dirty_row(this.termPtr, row) !== 0;
  }

  clearDirty(): void {
    this.wasm.exports.clear_dirty(this.termPtr);
    this._viewportStale = true;
  }

  getCols(): number {
    return this._cols;
  }

  getRows(): number {
    return this._rows;
  }

  // -- Cursor --

  getCursor(): CursorState {
    this._ensureViewport();
    return {
      row: this.wasm.exports.get_cursor_row(this.termPtr),
      col: this.wasm.exports.get_cursor_col(this.termPtr),
      visible: this.wasm.exports.get_cursor_visible(this.termPtr) !== 0,
    };
  }

  // -- Modes --

  cursorKeysApp(): boolean {
    return this.wasm.exports.cursor_keys_app(this.termPtr) !== 0;
  }

  bracketedPaste(): boolean {
    return this.wasm.exports.bracketed_paste(this.termPtr) !== 0;
  }

  usingAltScreen(): boolean {
    return this.wasm.exports.using_alt_screen(this.termPtr) !== 0;
  }

  mouseTracking(): 0 | 1000 | 1002 {
    const mode = this.wasm.exports.mouse_tracking(this.termPtr);
    return mode === 1000 || mode === 1002 ? mode : 0;
  }

  mouseSgr(): boolean {
    return this.wasm.exports.mouse_sgr(this.termPtr) !== 0;
  }

  focusEvents(): boolean {
    return this.wasm.exports.focus_events(this.termPtr) !== 0;
  }

  synchronizedOutput(): boolean {
    return this.wasm.exports.synchronized_output(this.termPtr) !== 0;
  }

  synchronizedOutputGeneration(): number {
    return this.wasm.exports.synchronized_output_generation(this.termPtr);
  }

  // -- Side outputs --

  getTitle(): string | null {
    // Title changes are delivered through OSC sequences which the
    // ReadonlyStream handler doesn't capture. A full stream handler
    // would be needed for title support.
    return null;
  }

  getResponse(): string | null {
    const bufSize = 4096;
    const bufPtr = allocBuffer(this.wasm, bufSize);
    if (bufPtr === 0) return null;
    const len = this.wasm.exports.read_response(this.termPtr, bufPtr, bufSize);
    if (len === 0) {
      freeBuffer(this.wasm, bufPtr, bufSize);
      return null;
    }
    const bytes = new Uint8Array(this.wasm.exports.memory.buffer, bufPtr, len);
    const text = new TextDecoder().decode(bytes);
    freeBuffer(this.wasm, bufPtr, bufSize);
    return text;
  }

  // -- Scrollback --

  getScrollbackCount(): number {
    return this.wasm.exports.get_scrollback_count(this.termPtr);
  }

  getScrollbackDiscardedCount(): number {
    return this.wasm.exports.get_scrollback_discarded_count(this.termPtr);
  }

  getScrollbackCell(offset: number, col: number): CellData {
    const len = this._ensureScrollbackLine(offset);
    const view = this._scrollbackView;
    if (!view || col >= len) return BLANK_CELL;

    const cell = parseCell(view, col * CELL_BYTES);
    const result: CellData = {
      char: cell.codepoint || 32,
      fg: DEFAULT_COLOR,
      bg: DEFAULT_COLOR,
      flags: cell.flags,
      width: cell.width,
    };
    if (cell.hasGrapheme)
      result.chars = this._readScrollbackGrapheme(offset, col);
    if (cell.hasHyperlink)
      Object.assign(result, this._readHyperlink(offset, col, true));
    if (cell.colorFlags & 1)
      result.fgRgb = packRgb(cell.fgR, cell.fgG, cell.fgB);
    if (cell.colorFlags & 2)
      result.bgRgb = packRgb(cell.bgR, cell.bgG, cell.bgB);
    return result;
  }

  getScrollbackLineLen(offset: number): number {
    return this._ensureScrollbackLine(offset);
  }

  // -- Debug --

  getUnhandledSequences(): UnhandledSequence[] {
    return [];
  }

  // -- Internal helpers --

  private _invalidate(): void {
    this._viewportStale = true;
    this._scrollbackOffset = -1;
  }

  private _decodeGrapheme(len: number): string | undefined {
    if (len === 0 || this._graphemeBufPtr === 0) return undefined;
    return new TextDecoder().decode(
      new Uint8Array(
        this.wasm.exports.memory.buffer,
        this._graphemeBufPtr,
        len,
      ),
    );
  }

  private _ensureGraphemeBuffer(required: number): void {
    if (required <= this._graphemeBufSize) return;
    if (this._graphemeBufPtr !== 0) {
      freeBuffer(this.wasm, this._graphemeBufPtr, this._graphemeBufSize);
    }
    this._graphemeBufSize = required;
    this._graphemeBufPtr = allocBuffer(this.wasm, required);
  }

  private _ensureHyperlinkBuffer(required: number): void {
    if (required <= this._hyperlinkBufSize) return;
    if (this._hyperlinkBufPtr !== 0) {
      freeBuffer(this.wasm, this._hyperlinkBufPtr, this._hyperlinkBufSize);
    }
    this._hyperlinkBufSize = required;
    this._hyperlinkBufPtr = allocBuffer(this.wasm, required);
  }

  private _readHyperlink(
    rowOrOffset: number,
    col: number,
    scrollback: boolean,
  ): { linkUri: string; linkId?: string; linkKey: string } | undefined {
    if (this._hyperlinkBufPtr === 0) return undefined;
    const read = scrollback
      ? this.wasm.exports.get_scrollback_hyperlink
      : this.wasm.exports.get_viewport_hyperlink;
    let len = read(
      this.termPtr,
      rowOrOffset,
      col,
      this._hyperlinkBufPtr,
      this._hyperlinkBufSize,
    );
    if (len > this._hyperlinkBufSize) {
      this._ensureHyperlinkBuffer(len);
      if (this._hyperlinkBufPtr === 0) return undefined;
      len = read(
        this.termPtr,
        rowOrOffset,
        col,
        this._hyperlinkBufPtr,
        this._hyperlinkBufSize,
      );
    }
    if (len === 0 || len > this._hyperlinkBufSize) return undefined;
    const text = new TextDecoder().decode(
      new Uint8Array(
        this.wasm.exports.memory.buffer,
        this._hyperlinkBufPtr,
        len,
      ),
    );
    const [linkUri, linkId = "", implicitId = ""] = text.split("\0");
    if (!linkUri) return undefined;
    const linkKey = linkId
      ? `e\0${linkId}\0${linkUri}`
      : `g\0${implicitId}\0${linkUri}`;
    return {
      linkUri,
      linkId: linkId || undefined,
      linkKey,
    };
  }

  private _readGrapheme(row: number, col: number): string | undefined {
    if (this._graphemeBufPtr === 0 || !this.wasm.exports.get_viewport_grapheme)
      return undefined;
    let len = this.wasm.exports.get_viewport_grapheme(
      this.termPtr,
      row,
      col,
      this._graphemeBufPtr,
      this._graphemeBufSize,
    );
    if (len > this._graphemeBufSize) {
      this._ensureGraphemeBuffer(len);
      len = this.wasm.exports.get_viewport_grapheme(
        this.termPtr,
        row,
        col,
        this._graphemeBufPtr,
        this._graphemeBufSize,
      );
    }
    return this._decodeGrapheme(len);
  }

  private _readScrollbackGrapheme(
    offset: number,
    col: number,
  ): string | undefined {
    if (
      this._graphemeBufPtr === 0 ||
      !this.wasm.exports.get_scrollback_grapheme
    )
      return undefined;
    let len = this.wasm.exports.get_scrollback_grapheme(
      this.termPtr,
      offset,
      col,
      this._graphemeBufPtr,
      this._graphemeBufSize,
    );
    if (len > this._graphemeBufSize) {
      this._ensureGraphemeBuffer(len);
      len = this.wasm.exports.get_scrollback_grapheme(
        this.termPtr,
        offset,
        col,
        this._graphemeBufPtr,
        this._graphemeBufSize,
      );
    }
    return this._decodeGrapheme(len);
  }

  private _allocViewportBuffer(): void {
    if (this._viewportBufPtr !== 0) {
      freeBuffer(this.wasm, this._viewportBufPtr, this._viewportBufSize);
    }
    this._viewportBufSize = this._cols * this._rows * CELL_BYTES;
    this._viewportBufPtr = allocBuffer(this.wasm, this._viewportBufSize);
    this._viewportView = null;
    this._viewportStale = true;

    if (this._scrollbackBufPtr !== 0) {
      freeBuffer(this.wasm, this._scrollbackBufPtr, this._scrollbackBufSize);
    }
    this._scrollbackBufSize = this._cols * CELL_BYTES;
    this._scrollbackBufPtr = allocBuffer(this.wasm, this._scrollbackBufSize);
    this._scrollbackView = null;
    this._scrollbackOffset = -1;
  }

  /**
   * Decode one scrollback row into the shared buffer, at most once per row
   * per invalidation, and return its length. The renderer reads a row column
   * by column, so without this each cell would cost a page-list walk.
   */
  private _ensureScrollbackLine(offset: number): number {
    if (this._scrollbackBufPtr === 0) return 0;

    if (this._scrollbackOffset !== offset) {
      this._scrollbackLen = this.wasm.exports.get_scrollback_line(
        this.termPtr,
        offset,
        this._scrollbackBufPtr,
        this._cols,
      );
      this._scrollbackOffset = offset;
    }

    // Growing WASM memory detaches the view, and a cached row outlives any
    // grow an unrelated read triggers in between, so check on hits too.
    if (this._scrollbackView?.buffer !== this.wasm.exports.memory.buffer) {
      this._scrollbackView = new DataView(
        this.wasm.exports.memory.buffer,
        this._scrollbackBufPtr,
        this._scrollbackBufSize,
      );
    }
    return this._scrollbackLen;
  }

  private _ensureViewport(): void {
    if (this._viewportStale) {
      this.wasm.exports.update(this.termPtr);
      this.wasm.exports.get_viewport(this.termPtr, this._viewportBufPtr);
      this._viewportStale = false;
    }
    if (this._viewportView?.buffer !== this.wasm.exports.memory.buffer) {
      this._viewportView = new DataView(
        this.wasm.exports.memory.buffer,
        this._viewportBufPtr,
        this._viewportBufSize,
      );
    }
  }
}
