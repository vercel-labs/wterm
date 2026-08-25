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

export interface TerminalResourceState {
  hyperlinks?: HyperlinkResourceState;
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

  // -- Side outputs --
  getTitle(): string | null;
  getResponse(): string | null;
  getResourceState?(): TerminalResourceState;

  // -- Scrollback --
  getScrollbackCount(): number;
  getScrollbackDiscardedCount?(): number;
  getScrollbackCell(offset: number, col: number): CellData;
  getScrollbackLineLen(offset: number): number;

  // -- Debug --
  getUnhandledSequences(): UnhandledSequence[];
}
