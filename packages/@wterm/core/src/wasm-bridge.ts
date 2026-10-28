import type {
  CellData,
  CursorState,
  MouseEncoding,
  TerminalResourceState,
  UnhandledSequence,
  TerminalCore,
} from "./terminal-core.js";
import { loadWasmModule } from "./wasm-loading.js";

/** Set in a cell char when the low bits index the core's grapheme cluster table. */
const CLUSTER_BIT = 0x80000000;
const DEFAULT_COLOR = 256;

interface WasmExports {
  memory: WebAssembly.Memory;
  init(cols: number, rows: number): void;
  resizeTerminal(cols: number, rows: number): void;
  getWriteBuffer(): number;
  writeBytes(len: number): void;
  getGridPtr(): number;
  getDirtyPtr(): number;
  getRowId?(row: number): number;
  clearDirty(): void;
  getCursorRow(): number;
  getCursorCol(): number;
  getCursorVisible(): number;
  getCursorShape?(): number;
  getCursorBlinking?(): number;
  getCols(): number;
  getRows(): number;
  getCursorKeysApp(): number;
  getBracketedPaste(): number;
  getUsingAltScreen(): number;
  getMouseTracking(): number;
  getMouseSgr(): number;
  getMouseEncoding?(): number;
  getFocusEvents(): number;
  getSynchronizedOutput(): number;
  getSynchronizedOutputGeneration(): number;
  getKittyKeyboardFlags?(): number;
  getTitlePtr(): number;
  getTitleLen(): number;
  getTitleChanged(): number;
  getBellCount?(): number;
  getLinkUriPtr(index: number): number;
  getLinkUriLen(index: number): number;
  getLinkIdPtr(index: number): number;
  getLinkIdLen(index: number): number;
  getClusterPtr?(index: number): number;
  getClusterLen?(index: number): number;
  getColorRgb?(index: number): number;
  getHyperlinkCapacity?(): number;
  getHyperlinkCount?(): number;
  getHyperlinkRejectedCount?(): number;
  getScrollbackCount(): number;
  getScrollbackDiscardedCount(): number;
  getScrollbackLine(offset: number): number;
  getScrollbackLineLen(offset: number): number;
  getScrollbackClearCount?(): number;
  getResponsePtr(): number;
  getResponseLen(): number;
  clearResponse(): void;
  getCellSize(): number;
  getGridStride(): number;
  getDebugLogPtr(): number;
  getDebugLogCount(): number;
  getDebugLogEntrySize(): number;
  getDebugLogMax(): number;
}

export class WasmBridge implements TerminalCore {
  private exports: WasmExports;
  private memory: WebAssembly.Memory;
  private gridPtr = 0;
  private dirtyPtr = 0;
  private writeBufferPtr = 0;
  private cellSize = 12;
  private gridStride = 0;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private _dv!: DataView;
  private _dvBuffer: ArrayBuffer | null = null;
  private clusterCache = new Map<number, string>();
  private linkCache = new Map<
    number,
    { linkUri: string; linkId?: string; linkKey: string }
  >();

  private clearedRowIds = new Uint32Array(0);

  private get dv(): DataView {
    if (this._dvBuffer !== this.memory.buffer) {
      this._dvBuffer = this.memory.buffer;
      this._dv = new DataView(this.memory.buffer);
    }
    return this._dv;
  }

  constructor(instance: WebAssembly.Instance) {
    this.exports = instance.exports as unknown as WasmExports;
    this.memory = this.exports.memory;
  }

  static async load(url?: string): Promise<WasmBridge> {
    const module = await loadWasmModule(url);
    const instance = await WebAssembly.instantiate(module);
    return new WasmBridge(instance);
  }

  init(cols: number, rows: number): void {
    this.exports.init(cols, rows);
    this.linkCache.clear();
    this.clusterCache.clear();
    this._updatePointers();
  }

  private _updatePointers(): void {
    this.gridPtr = this.exports.getGridPtr();
    this.dirtyPtr = this.exports.getDirtyPtr();
    this.writeBufferPtr = this.exports.getWriteBuffer();
    this.cellSize = this.exports.getCellSize();
    this.gridStride = this.exports.getGridStride();
  }

  writeString(str: string, afterChunk?: () => void): void {
    const encoded = this.encoder.encode(str);
    this.writeRaw(encoded, afterChunk);
  }

  writeRaw(data: Uint8Array, afterChunk?: () => void): void {
    let offset = 0;
    while (offset < data.length) {
      const chunk = Math.min(data.length - offset, 8192);
      const buf = new Uint8Array(this.memory.buffer, this.writeBufferPtr, 8192);
      buf.set(data.subarray(offset, offset + chunk));
      this.exports.writeBytes(chunk);
      // Escape sequences can swap the active screen and its backing storage.
      this._updatePointers();
      offset += chunk;
      afterChunk?.();
    }
  }

  getCell(row: number, col: number): CellData {
    const offset = this.gridPtr + (row * this.gridStride + col) * this.cellSize;
    const dv = this.dv;
    const result: CellData = {
      char: dv.getUint32(offset, true),
      fg: dv.getUint16(offset + 4, true),
      bg: dv.getUint16(offset + 6, true),
      flags: dv.getUint8(offset + 8),
      width: dv.getUint8(offset + 9),
    };
    this._resolveCluster(result);
    this._resolveRgb(result);
    Object.assign(result, this._readLink(dv.getUint16(offset + 10, true)));
    return result;
  }

  /** Times the history was cleared, as by CSI 3 J or reinitialization. */
  getScrollbackClearCount(): number {
    return this.exports.getScrollbackClearCount?.() ?? 0;
  }

  /** Raw hyperlink table index of a grid cell; 0 when it has no link. */
  getCellLinkIndex(row: number, col: number): number {
    const offset = this.gridPtr + (row * this.gridStride + col) * this.cellSize;
    return this.dv.getUint16(offset + 10, true);
  }

  /** Raw hyperlink table index of a scrollback cell; 0 when it has no link. */
  getScrollbackLinkIndex(offset: number, col: number): number {
    const ptr = this.exports.getScrollbackLine(offset);
    return this.dv.getUint16(ptr + col * this.cellSize + 10, true);
  }

  isDirtyRow(row: number): boolean {
    if (this.isRowContentDirty(row)) return true;
    const id = this.getRowId(row);
    return id === null
      ? this.exports.getRowId !== undefined
      : id !== this.clearedRowIds[row];
  }

  isRowContentDirty(row: number): boolean {
    return (
      new Uint8Array(this.memory.buffer, this.dirtyPtr, this.getRows())[row] !==
      0
    );
  }

  getRowId(row: number): number | null {
    if (!Number.isInteger(row) || row < 0 || row >= this.getRows()) return null;
    const id = this.exports.getRowId?.(row) ?? 0;
    return id === 0 ? null : id >>> 0;
  }

  clearDirty(): void {
    const getRowId = this.exports.getRowId;
    if (getRowId) {
      const rows = this.getRows();
      if (this.clearedRowIds.length !== rows) {
        this.clearedRowIds = new Uint32Array(rows);
      }
      for (let row = 0; row < rows; row++) {
        this.clearedRowIds[row] = getRowId(row);
      }
    }
    this.exports.clearDirty();
  }

  getCursor(): CursorState {
    const shape = this.exports.getCursorShape?.() ?? 0;
    return {
      row: this.exports.getCursorRow(),
      col: this.exports.getCursorCol(),
      visible: this.exports.getCursorVisible() !== 0,
      shape: shape === 1 ? "underline" : shape === 2 ? "bar" : "block",
      blinking: (this.exports.getCursorBlinking?.() ?? 0) !== 0,
    };
  }

  getCols(): number {
    return this.exports.getCols();
  }
  getRows(): number {
    return this.exports.getRows();
  }

  cursorKeysApp(): boolean {
    return this.exports.getCursorKeysApp() !== 0;
  }
  bracketedPaste(): boolean {
    return this.exports.getBracketedPaste() !== 0;
  }
  usingAltScreen(): boolean {
    return this.exports.getUsingAltScreen() !== 0;
  }
  mouseTracking(): 0 | 1000 | 1002 | 1003 {
    const mode = this.exports.getMouseTracking();
    return mode === 1000 || mode === 1002 || mode === 1003 ? mode : 0;
  }
  mouseSgr(): boolean {
    return this.exports.getMouseSgr() !== 0;
  }
  mouseEncoding(): MouseEncoding | null {
    const mode = this.exports.getMouseEncoding?.();
    switch (mode) {
      case 0:
        return "x10";
      case 1:
        return "utf8";
      case 2:
        return "sgr";
      case 3:
        return "urxvt";
      case 4:
        return "sgr-pixels";
      case undefined:
        return this.mouseSgr() ? "sgr" : "x10";
      default:
        return null;
    }
  }
  focusEvents(): boolean {
    return this.exports.getFocusEvents() !== 0;
  }
  synchronizedOutput(): boolean {
    return this.exports.getSynchronizedOutput() !== 0;
  }
  synchronizedOutputGeneration(): number {
    return this.exports.getSynchronizedOutputGeneration();
  }
  kittyKeyboardFlags(): number {
    return this.exports.getKittyKeyboardFlags?.() ?? 0;
  }

  getTitle(): string | null {
    if (this.exports.getTitleChanged() === 0) return null;
    const ptr = this.exports.getTitlePtr();
    const len = this.exports.getTitleLen();
    const bytes = new Uint8Array(this.memory.buffer, ptr, len);
    return this.decoder.decode(bytes);
  }

  getBellCount(): number {
    return this.exports.getBellCount?.() ?? 0;
  }

  getResponse(): string | null {
    const len = this.exports.getResponseLen();
    if (len === 0) return null;
    const ptr = this.exports.getResponsePtr();
    const bytes = new Uint8Array(this.memory.buffer, ptr, len);
    const str = this.decoder.decode(bytes);
    this.exports.clearResponse();
    return str;
  }

  getResourceState(): TerminalResourceState {
    const capacity = this.exports.getHyperlinkCapacity?.();
    const used = this.exports.getHyperlinkCount?.();
    const rejected = this.exports.getHyperlinkRejectedCount?.();
    if (
      capacity === undefined ||
      used === undefined ||
      rejected === undefined
    ) {
      return {};
    }
    return {
      hyperlinks: {
        capacity,
        used,
        rejected,
        saturated: used >= capacity,
      },
    };
  }

  getScrollbackCount(): number {
    return this.exports.getScrollbackCount();
  }

  getScrollbackDiscardedCount(): number {
    return this.exports.getScrollbackDiscardedCount();
  }

  getScrollbackCell(offset: number, col: number): CellData {
    const ptr = this.exports.getScrollbackLine(offset);
    const off = ptr + col * this.cellSize;
    const dv = this.dv;
    const result: CellData = {
      char: dv.getUint32(off, true),
      fg: dv.getUint16(off + 4, true),
      bg: dv.getUint16(off + 6, true),
      flags: dv.getUint8(off + 8),
      width: dv.getUint8(off + 9),
    };
    this._resolveCluster(result);
    this._resolveRgb(result);
    Object.assign(result, this._readLink(dv.getUint16(off + 10, true)));
    return result;
  }

  getScrollbackLineLen(offset: number): number {
    return this.exports.getScrollbackLineLen(offset);
  }

  getUnhandledSequences(): UnhandledSequence[] {
    const count = this.exports.getDebugLogCount();
    if (count === 0) return [];
    const ptr = this.exports.getDebugLogPtr();
    const entrySize = this.exports.getDebugLogEntrySize();
    const maxEntries = this.exports.getDebugLogMax();
    const total = Math.min(count, maxEntries);
    const dv = new DataView(this.memory.buffer);
    const entries: UnhandledSequence[] = [];
    const startIdx = count >= maxEntries ? count % maxEntries : 0;
    for (let i = 0; i < total; i++) {
      const idx = (startIdx + i) % maxEntries;
      const off = ptr + idx * entrySize;
      const finalByte = dv.getUint8(off);
      if (finalByte === 0) continue;
      const privateByte = dv.getUint8(off + 1);
      const paramCount = dv.getUint8(off + 2);
      const params: number[] = [];
      for (let p = 0; p < Math.min(paramCount, 4); p++) {
        params.push(dv.getUint16(off + 4 + p * 2, true));
      }
      entries.push({
        final: String.fromCharCode(finalByte),
        private: privateByte ? String.fromCharCode(privateByte) : "",
        paramCount,
        params,
      });
    }
    return entries;
  }

  resize(cols: number, rows: number): void {
    this.exports.resizeTerminal(cols, rows);
    this._updatePointers();
  }

  private _resolveCluster(cell: CellData): void {
    if (cell.char < CLUSTER_BIT) return;
    const index = cell.char - CLUSTER_BIT;
    let chars = this.clusterCache.get(index);
    if (chars === undefined) {
      const len = this.exports.getClusterLen?.(index) ?? 0;
      chars =
        len === 0
          ? ""
          : this.decoder.decode(
              new Uint8Array(
                this.memory.buffer,
                this.exports.getClusterPtr!(index),
                len,
              ),
            );
      this.clusterCache.set(index, chars);
    }
    cell.char = chars.codePointAt(0) ?? 32;
    if (chars.length > String.fromCodePoint(cell.char).length)
      cell.chars = chars;
  }

  private _resolveRgb(cell: CellData): void {
    if (cell.fg > DEFAULT_COLOR) {
      const rgb = this._readRgb(cell.fg);
      if (rgb !== undefined) cell.fgRgb = rgb;
    }
    if (cell.bg > DEFAULT_COLOR) {
      const rgb = this._readRgb(cell.bg);
      if (rgb !== undefined) cell.bgRgb = rgb;
    }
  }

  private _readRgb(index: number): number | undefined {
    const rgb = this.exports.getColorRgb?.(index);
    if (rgb === undefined) return undefined;
    // WASM returns u32 as a signed i32; the 0xFFFFFFFF miss marker reads as -1.
    return rgb < 0 || rgb > 0xffffff ? undefined : rgb;
  }

  private _readLink(
    index: number,
  ): { linkUri: string; linkId?: string; linkKey: string } | undefined {
    if (index === 0) return undefined;
    const cached = this.linkCache.get(index);
    if (cached) return cached;

    const uriLen = this.exports.getLinkUriLen(index);
    if (uriLen === 0) return undefined;
    const uri = this.decoder.decode(
      new Uint8Array(
        this.memory.buffer,
        this.exports.getLinkUriPtr(index),
        uriLen,
      ),
    );
    const idLen = this.exports.getLinkIdLen(index);
    const linkId =
      idLen === 0
        ? undefined
        : this.decoder.decode(
            new Uint8Array(
              this.memory.buffer,
              this.exports.getLinkIdPtr(index),
              idLen,
            ),
          );
    const value = {
      linkUri: uri,
      linkId,
      linkKey: linkId ? `e\0${linkId}\0${uri}` : `b\0${index}`,
    };
    this.linkCache.set(index, value);
    return value;
  }
}
