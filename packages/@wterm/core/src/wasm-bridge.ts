import type {
  CellData,
  CursorState,
  TerminalResourceState,
  UnhandledSequence,
  TerminalCore,
} from "./terminal-core.js";

interface WasmExports {
  memory: WebAssembly.Memory;
  init(cols: number, rows: number): void;
  resizeTerminal(cols: number, rows: number): void;
  getWriteBuffer(): number;
  writeBytes(len: number): void;
  getGridPtr(): number;
  getDirtyPtr(): number;
  clearDirty(): void;
  getCursorRow(): number;
  getCursorCol(): number;
  getCursorVisible(): number;
  getCols(): number;
  getRows(): number;
  getCursorKeysApp(): number;
  getBracketedPaste(): number;
  getUsingAltScreen(): number;
  getMouseTracking(): number;
  getMouseSgr(): number;
  getFocusEvents(): number;
  getSynchronizedOutput(): number;
  getSynchronizedOutputGeneration(): number;
  getTitlePtr(): number;
  getTitleLen(): number;
  getTitleChanged(): number;
  getLinkUriPtr(index: number): number;
  getLinkUriLen(index: number): number;
  getLinkIdPtr(index: number): number;
  getLinkIdLen(index: number): number;
  getHyperlinkCapacity?(): number;
  getHyperlinkCount?(): number;
  getHyperlinkRejectedCount?(): number;
  getScrollbackCount(): number;
  getScrollbackDiscardedCount(): number;
  getScrollbackLine(offset: number): number;
  getScrollbackLineLen(offset: number): number;
  getResponsePtr(): number;
  getResponseLen(): number;
  clearResponse(): void;
  getCellSize(): number;
  getMaxCols(): number;
  getDebugLogPtr(): number;
  getDebugLogCount(): number;
  getDebugLogEntrySize(): number;
  getDebugLogMax(): number;
}

import { WASM_BASE64 } from "./wasm-inline.js";

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class WasmBridge implements TerminalCore {
  private exports: WasmExports;
  private memory: WebAssembly.Memory;
  private gridPtr = 0;
  private dirtyPtr = 0;
  private writeBufferPtr = 0;
  private cellSize = 12;
  private maxCols = 256;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private _dv!: DataView;
  private _dvBuffer: ArrayBuffer | null = null;
  private linkCache = new Map<
    number,
    { linkUri: string; linkId?: string; linkKey: string }
  >();

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
    let bytes: ArrayBuffer;
    if (url) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `[wterm] Failed to load WASM from ${url}: ${response.status} ${response.statusText}`,
        );
      }
      bytes = await response.arrayBuffer();
    } else {
      bytes = decodeBase64(WASM_BASE64);
    }
    const { instance } = await WebAssembly.instantiate(bytes);
    return new WasmBridge(instance);
  }

  init(cols: number, rows: number): void {
    this.exports.init(cols, rows);
    this.linkCache.clear();
    this._updatePointers();
  }

  private _updatePointers(): void {
    this.gridPtr = this.exports.getGridPtr();
    this.dirtyPtr = this.exports.getDirtyPtr();
    this.writeBufferPtr = this.exports.getWriteBuffer();
    this.cellSize = this.exports.getCellSize();
    this.maxCols = this.exports.getMaxCols();
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
      offset += chunk;
      afterChunk?.();
    }
  }

  getCell(row: number, col: number): CellData {
    const offset = this.gridPtr + (row * this.maxCols + col) * this.cellSize;
    const dv = this.dv;
    const result: CellData = {
      char: dv.getUint32(offset, true),
      fg: dv.getUint16(offset + 4, true),
      bg: dv.getUint16(offset + 6, true),
      flags: dv.getUint8(offset + 8),
      width: dv.getUint8(offset + 9),
    };
    Object.assign(result, this._readLink(dv.getUint16(offset + 10, true)));
    return result;
  }

  isDirtyRow(row: number): boolean {
    return new Uint8Array(this.memory.buffer, this.dirtyPtr, 256)[row] !== 0;
  }

  clearDirty(): void {
    this.exports.clearDirty();
  }

  getCursor(): CursorState {
    return {
      row: this.exports.getCursorRow(),
      col: this.exports.getCursorCol(),
      visible: this.exports.getCursorVisible() !== 0,
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
  mouseTracking(): 0 | 1000 | 1002 {
    const mode = this.exports.getMouseTracking();
    return mode === 1000 || mode === 1002 ? mode : 0;
  }
  mouseSgr(): boolean {
    return this.exports.getMouseSgr() !== 0;
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

  getTitle(): string | null {
    if (this.exports.getTitleChanged() === 0) return null;
    const ptr = this.exports.getTitlePtr();
    const len = this.exports.getTitleLen();
    const bytes = new Uint8Array(this.memory.buffer, ptr, len);
    return this.decoder.decode(bytes);
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
