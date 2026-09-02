export interface CellData {
  char: number;
  /** Full grapheme cluster. Present when the cell contains more than one code point. */
  chars?: string;
  fg: number;
  bg: number;
  flags: number;
  /** Display width: 1 = narrow, 2 = wide leading cell, 0 = wide continuation cell. */
  width?: number;
  /** Resolved 24-bit foreground color (0xRRGGBB). Present when the core provides true color. */
  fgRgb?: number;
  /** Resolved 24-bit background color (0xRRGGBB). Present when the core provides true color. */
  bgRgb?: number;
  /** Resolved OSC 8 URI for this cell. */
  linkUri?: string;
  /** Explicit OSC 8 `id=` parameter, when provided. */
  linkId?: string;
  /** Opaque semantic identity used to group cells from the same OSC 8 link. */
  linkKey?: string;
}

export interface CursorState {
  row: number;
  col: number;
  visible: boolean;
}

export interface UnhandledSequence {
  final: string;
  private: string;
  paramCount: number;
  params: number[];
}

export interface HyperlinkResourceState {
  capacity: number;
  used: number;
  rejected: number;
  saturated: boolean;
}

/** Metadata for one decoded terminal image. IDs are scoped to the active screen. */
export interface TerminalImageDescriptor {
  imageId: number;
  version: number;
  width: number;
  height: number;
}

/** A pinned, non-virtual image placement in the retained active screen. */
export interface TerminalImagePlacement {
  placementKey: string;
  imageId: number;
  imageVersion: number;
  /** Zero-based retained row, with row zero at the oldest retained row. */
  row: number;
  col: number;
  offsetX: number;
  offsetY: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Requested cell dimensions. Zero means that dimension was not specified. */
  columns: number;
  rows: number;
  z: number;
}

export interface TerminalGraphicsState {
  generation: number;
  images: TerminalImageDescriptor[];
  placements: TerminalImagePlacement[];
}

export interface TerminalImageData {
  imageId: number;
  version: number;
  width: number;
  height: number;
  /** Tightly packed, row-major RGBA bytes. The returned buffer is a copy. */
  rgba: Uint8Array;
}

export interface GraphicsResourceState {
  capacity: number;
  used: number;
  imageCount: number;
  placementCount: number;
  rejected: number;
  evicted: number;
  saturated: boolean;
}

export interface TerminalResourceState {
  hyperlinks?: HyperlinkResourceState;
  graphics?: GraphicsResourceState;
}

/**
 * Abstract terminal emulation core. Both the built-in Zig WASM core
 * (`WasmBridge`) and alternative backends (e.g. `@wterm/ghostty`) implement
 * this interface so that `@wterm/dom` can render any core interchangeably.
 */
export interface TerminalCore {
  // -- Lifecycle --
  init(cols: number, rows: number): void;
  resize(cols: number, rows: number): void;

  // -- I/O --
  writeString(str: string, afterChunk?: () => void): void;
  writeRaw(data: Uint8Array, afterChunk?: () => void): void;

  // -- Grid --
  getCell(row: number, col: number): CellData;
  isDirtyRow(row: number): boolean;
  clearDirty(): void;
  getCols(): number;
  getRows(): number;

  // -- Cursor --
  getCursor(): CursorState;

  // -- Modes --
  cursorKeysApp(): boolean;
  bracketedPaste(): boolean;
  usingAltScreen(): boolean;
  mouseTracking?(): 0 | 1000 | 1002;
  mouseSgr?(): boolean;
  focusEvents?(): boolean;
  synchronizedOutput?(): boolean;
  synchronizedOutputGeneration?(): number;
  kittyKeyboardFlags?(): number;

  // -- Side outputs --
  getTitle(): string | null;
  getResponse(): string | null;
  getResourceState?(): TerminalResourceState;

  // -- Optional terminal graphics --
  /** Returns a caller-owned snapshot for the active screen, or no state. */
  getGraphicsState?(): TerminalGraphicsState | null;
  /** Returns caller-owned RGBA pixels, or null when unavailable/invalid. */
  getGraphicsImage?(imageId: number, version: number): TerminalImageData | null;

  // -- Scrollback --
  getScrollbackCount(): number;
  getScrollbackDiscardedCount?(): number;
  getScrollbackCell(offset: number, col: number): CellData;
  getScrollbackLineLen(offset: number): number;

  // -- Debug --
  getUnhandledSequences(): UnhandledSequence[];
}
