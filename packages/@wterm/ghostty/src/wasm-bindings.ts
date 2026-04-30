/**
 * Low-level typed bindings to the ghostty-vt WASM module built from
 * our Zig export layer (zig/src/wasm_api.zig).
 *
 * Each exported Zig function maps 1:1 to a property on GhosttyExports.
 * This module handles WASM loading, memory management, and cell parsing.
 */

export interface GhosttyExports {
  memory: WebAssembly.Memory;

  // Lifecycle
  init(cols: number, rows: number, max_scrollback: number): number;
  deinit(ptr: number): void;
  resize(ptr: number, cols: number, rows: number): void;

  // Data input
  write(ptr: number, data_ptr: number, data_len: number): void;

  // Render state
  update(ptr: number): void;
  get_viewport(ptr: number, buf_ptr: number): number;

  // Dirty tracking
  is_dirty(ptr: number): number;
  is_dirty_row(ptr: number, row: number): number;
  clear_dirty(ptr: number): void;

  // Cursor
  get_cursor_row(ptr: number): number;
  get_cursor_col(ptr: number): number;
  get_cursor_visible(ptr: number): number;

  // Modes
  cursor_keys_app(ptr: number): number;
  bracketed_paste(ptr: number): number;
  using_alt_screen(ptr: number): number;

  // Grid
  get_cols(ptr: number): number;
  get_rows(ptr: number): number;

  // Scrollback
  get_scrollback_count(ptr: number): number;
  get_scrollback_line(
    ptr: number,
    offset: number,
    buf_ptr: number,
    max_cols: number,
  ): number;

  // Responses
  read_response(ptr: number, buf_ptr: number, buf_len: number): number;

  // Memory
  alloc_buffer(len: number): number;
  free_buffer(ptr: number, len: number): void;
}

export interface GhosttyWasm {
  exports: GhosttyExports;
  instance: WebAssembly.Instance;
}

const CELL_BYTES = 16;

const DEFAULT_WASM_PATH = new URL("../wasm/ghostty-vt.wasm", import.meta.url)
  .href;

/**
 * Load the ghostty-vt WASM module.
 *
 * @param wasmUrl - URL or path to the .wasm file. Defaults to the
 *   committed binary at `../wasm/ghostty-vt.wasm`.
 */
export async function loadGhosttyWasm(wasmUrl?: string): Promise<GhosttyWasm> {
  const url = wasmUrl ?? DEFAULT_WASM_PATH;
  const response = await fetch(url);
  const bytes = await response.arrayBuffer();

  let wasmMemory: WebAssembly.Memory;

  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      log(ptr: number, len: number) {
        const text = new TextDecoder().decode(
          new Uint8Array(wasmMemory.buffer, ptr, len),
        );
        console.log("[ghostty-vt]", text);
      },
    },
  });

  wasmMemory = instance.exports.memory as WebAssembly.Memory;
  const exports = instance.exports as unknown as GhosttyExports;
  return { exports, instance };
}

/** Parsed cell data from the viewport buffer. */
export interface WasmCellData {
  codepoint: number;
  fgR: number;
  fgG: number;
  fgB: number;
  bgR: number;
  bgG: number;
  bgB: number;
  flags: number;
  width: number;
  /** Bit 0: has explicit fg color, Bit 1: has explicit bg color */
  colorFlags: number;
}

/**
 * Parse a single cell from the viewport buffer at the given byte offset.
 * The buffer layout matches the 16-byte struct from wasm_api.zig.
 */
export function parseCell(view: DataView, byteOffset: number): WasmCellData {
  return {
    codepoint: view.getUint32(byteOffset, true),
    fgR: view.getUint8(byteOffset + 4),
    fgG: view.getUint8(byteOffset + 5),
    fgB: view.getUint8(byteOffset + 6),
    bgR: view.getUint8(byteOffset + 7),
    bgG: view.getUint8(byteOffset + 8),
    bgB: view.getUint8(byteOffset + 9),
    flags: view.getUint8(byteOffset + 10),
    width: view.getUint8(byteOffset + 11),
    colorFlags: view.getUint8(byteOffset + 12),
  };
}

/** Byte size of one cell in the viewport buffer. */
export { CELL_BYTES };

/**
 * Allocate a buffer in WASM memory and return its pointer.
 * The caller must free it with freeBuffer when done.
 */
export function allocBuffer(wasm: GhosttyWasm, size: number): number {
  return wasm.exports.alloc_buffer(size);
}

/** Free a buffer previously allocated with allocBuffer. */
export function freeBuffer(wasm: GhosttyWasm, ptr: number, size: number): void {
  wasm.exports.free_buffer(ptr, size);
}

/**
 * Write a UTF-8 string into WASM memory and call the terminal's write
 * function. Handles allocation/deallocation of the transfer buffer.
 */
export function writeString(
  wasm: GhosttyWasm,
  termPtr: number,
  str: string,
): void {
  const encoded = new TextEncoder().encode(str);
  writeBytes(wasm, termPtr, encoded);
}

/**
 * Write raw bytes into the terminal. Handles allocation/deallocation
 * of the transfer buffer.
 */
export function writeBytes(
  wasm: GhosttyWasm,
  termPtr: number,
  data: Uint8Array,
): void {
  if (data.length === 0) return;
  const bufPtr = allocBuffer(wasm, data.length);
  if (bufPtr === 0) return;
  new Uint8Array(wasm.exports.memory.buffer, bufPtr, data.length).set(data);
  wasm.exports.write(termPtr, bufPtr, data.length);
  freeBuffer(wasm, bufPtr, data.length);
}
