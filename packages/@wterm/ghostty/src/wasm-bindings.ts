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
  init(
    cols: number,
    rows: number,
    max_scrollback: number,
    foreground_rgb: number,
    background_rgb: number,
    image_storage_limit: number,
  ): number;
  deinit(ptr: number): void;
  resize(ptr: number, cols: number, rows: number): void;

  // Data input
  write(ptr: number, data_ptr: number, data_len: number): void;

  // Render state
  update(ptr: number): void;
  get_viewport(ptr: number, buf_ptr: number): number;
  get_viewport_grapheme(
    ptr: number,
    row: number,
    col: number,
    buf_ptr: number,
    buf_len: number,
  ): number;
  get_viewport_hyperlink(
    ptr: number,
    row: number,
    col: number,
    buf_ptr: number,
    buf_len: number,
  ): number;

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
  mouse_tracking(ptr: number): number;
  mouse_sgr(ptr: number): number;
  focus_events(ptr: number): number;
  synchronized_output(ptr: number): number;
  synchronized_output_generation(ptr: number): number;
  kitty_keyboard_flags?(ptr: number): number;

  graphics_generation?(ptr: number): number;
  graphics_image_count?(ptr: number): number;
  graphics_placement_count?(ptr: number): number;
  graphics_bytes_used?(ptr: number): number;
  graphics_capacity?(ptr: number): number;
  graphics_rejected?(ptr: number): number;
  graphics_evicted?(ptr: number): number;
  graphics_images?(ptr: number, buf_ptr: number, max_records: number): number;
  graphics_placements?(
    ptr: number,
    buf_ptr: number,
    max_records: number,
  ): number;
  graphics_image_size?(ptr: number, image_id: number, version: number): number;
  graphics_image_copy?(
    ptr: number,
    image_id: number,
    version: number,
    buf_ptr: number,
    buf_len: number,
  ): number;

  // Grid
  get_cols(ptr: number): number;
  get_rows(ptr: number): number;

  // Scrollback
  get_scrollback_count(ptr: number): number;
  get_scrollback_discarded_count(ptr: number): number;
  get_scrollback_line(
    ptr: number,
    offset: number,
    buf_ptr: number,
    max_cols: number,
  ): number;
  get_scrollback_grapheme(
    ptr: number,
    offset: number,
    col: number,
    buf_ptr: number,
    buf_len: number,
  ): number;
  get_scrollback_hyperlink(
    ptr: number,
    offset: number,
    col: number,
    buf_ptr: number,
    buf_len: number,
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

const REMEDY =
  "Serve the binary from your app and pass its URL: " +
  'GhosttyCore.load({ wasmPath: "/ghostty-vt.wasm" }). The file ships with ' +
  "the package as @wterm/ghostty/ghostty-vt.wasm. See the Bundlers section " +
  "of the @wterm/ghostty README.";

/**
 * Resolve the binary that ships with the package.
 *
 * Bundlers that implement the `new URL(..., import.meta.url)` asset pattern
 * rewrite this to an emitted asset. Ones that do not leave `import.meta.url`
 * pointing at the build machine's copy of this file.
 */
function defaultWasmUrl(): string {
  return new URL("../wasm/ghostty-vt.wasm", import.meta.url).href;
}

/** `\0asm`. A 404 HTML page otherwise dies as "expected magic word". */
function hasWasmMagic(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false;
  const head = new Uint8Array(bytes, 0, 4);
  return (
    head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d
  );
}

/**
 * Load the ghostty-vt WASM module.
 *
 * @param wasmUrl - URL or path to the .wasm file. Defaults to the
 *   committed binary at `../wasm/ghostty-vt.wasm`.
 */
export async function loadGhosttyWasm(wasmUrl?: string): Promise<GhosttyWasm> {
  const url = wasmUrl ?? defaultWasmUrl();

  // A file: URL in a browser is a build-machine path that survived bundling.
  // fetch() reports it as a bare "Failed to fetch", which names neither the
  // cause nor the fix.
  if (
    wasmUrl === undefined &&
    url.startsWith("file:") &&
    typeof document !== "undefined"
  ) {
    throw new Error(
      `@wterm/ghostty: your bundler resolved the WASM URL to ${url}, a path ` +
        `on the machine that built the bundle, so the browser cannot fetch ` +
        `it. ${REMEDY}`,
    );
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `@wterm/ghostty: fetching ${url} returned ${response.status} ` +
        `${response.statusText}. ${REMEDY}`,
    );
  }

  const bytes = await response.arrayBuffer();
  if (!hasWasmMagic(bytes)) {
    throw new Error(
      `@wterm/ghostty: ${url} did not return a WASM module. ${REMEDY}`,
    );
  }

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
  hasGrapheme: boolean;
  hasHyperlink: boolean;
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
    hasGrapheme: (view.getUint8(byteOffset + 13) & 1) !== 0,
    hasHyperlink: (view.getUint8(byteOffset + 13) & 2) !== 0,
  };
}

/** Byte size of one cell in the viewport buffer. */
export { CELL_BYTES };

/**
 * Allocate a buffer in WASM memory and return its pointer.
 * The caller must free it with freeBuffer when done.
 */
export function allocBuffer(wasm: GhosttyWasm, size: number): number {
  if (!Number.isSafeInteger(size) || size <= 0 || size > 0xffffffff) return 0;
  try {
    return wasm.exports.alloc_buffer(size);
  } catch {
    return 0;
  }
}

/** Free a buffer previously allocated with allocBuffer. */
export function freeBuffer(wasm: GhosttyWasm, ptr: number, size: number): void {
  if (ptr === 0 || !Number.isSafeInteger(size) || size <= 0) return;
  try {
    wasm.exports.free_buffer(ptr, size);
  } catch {
    // A failed cleanup must not turn a recoverable terminal read into a throw.
  }
}

export const GRAPHICS_IMAGE_BYTES = 16;
export const GRAPHICS_PLACEMENT_BYTES = 60;

export interface WasmGraphicsImage {
  imageId: number;
  version: number;
  width: number;
  height: number;
}

export interface WasmGraphicsPlacement {
  placementKey: string;
  imageId: number;
  imageVersion: number;
  row: number;
  col: number;
  offsetX: number;
  offsetY: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  columns: number;
  rows: number;
  z: number;
}

export function readGraphicsImages(
  wasm: GhosttyWasm,
  termPtr: number,
  bufPtr: number,
  capacity: number,
): WasmGraphicsImage[] {
  const read = wasm.exports.graphics_images;
  if (!read || !Number.isSafeInteger(capacity) || capacity < 0) return [];
  let count: number;
  try {
    count = read(termPtr, bufPtr, capacity);
  } catch {
    return [];
  }
  if (!Number.isSafeInteger(count) || count < 0 || count > capacity) return [];
  const byteLength = count * GRAPHICS_IMAGE_BYTES;
  if (!Number.isSafeInteger(byteLength)) return [];
  let view: DataView;
  try {
    view = new DataView(wasm.exports.memory.buffer, bufPtr, byteLength);
  } catch {
    return [];
  }
  const result: WasmGraphicsImage[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * GRAPHICS_IMAGE_BYTES;
    result.push({
      imageId: view.getUint32(offset, true),
      version: view.getUint32(offset + 4, true),
      width: view.getUint32(offset + 8, true),
      height: view.getUint32(offset + 12, true),
    });
  }
  return result;
}

export function readGraphicsPlacements(
  wasm: GhosttyWasm,
  termPtr: number,
  bufPtr: number,
  capacity: number,
): WasmGraphicsPlacement[] {
  const read = wasm.exports.graphics_placements;
  if (!read || !Number.isSafeInteger(capacity) || capacity < 0) return [];
  let count: number;
  try {
    count = read(termPtr, bufPtr, capacity);
  } catch {
    return [];
  }
  if (!Number.isSafeInteger(count) || count < 0 || count > capacity) return [];
  const byteLength = count * GRAPHICS_PLACEMENT_BYTES;
  if (!Number.isSafeInteger(byteLength)) return [];
  let view: DataView;
  try {
    view = new DataView(wasm.exports.memory.buffer, bufPtr, byteLength);
  } catch {
    return [];
  }
  const result: WasmGraphicsPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * GRAPHICS_PLACEMENT_BYTES;
    const imageId = view.getUint32(offset, true);
    const placementId = view.getUint32(offset + 4, true);
    const placementTag = view.getUint32(offset + 56, true);
    result.push({
      placementKey: `${imageId}:${placementId}:${placementTag}`,
      imageId,
      imageVersion: view.getUint32(offset + 8, true),
      row: view.getUint32(offset + 12, true),
      col: view.getUint32(offset + 16, true),
      offsetX: view.getUint32(offset + 20, true),
      offsetY: view.getUint32(offset + 24, true),
      sourceX: view.getUint32(offset + 28, true),
      sourceY: view.getUint32(offset + 32, true),
      sourceWidth: view.getUint32(offset + 36, true),
      sourceHeight: view.getUint32(offset + 40, true),
      columns: view.getUint32(offset + 44, true),
      rows: view.getUint32(offset + 48, true),
      z: view.getInt32(offset + 52, true),
    });
  }
  return result;
}

/**
 * Write a UTF-8 string into WASM memory and call the terminal's write
 * function. Handles allocation/deallocation of the transfer buffer.
 */
export function writeString(
  wasm: GhosttyWasm,
  termPtr: number,
  str: string,
  afterChunk?: () => void,
): void {
  const encoded = new TextEncoder().encode(str);
  writeBytes(wasm, termPtr, encoded, afterChunk);
}

/**
 * Write raw bytes into the terminal. Handles allocation/deallocation
 * of the transfer buffer.
 */
export function writeBytes(
  wasm: GhosttyWasm,
  termPtr: number,
  data: Uint8Array,
  afterChunk?: () => void,
): void {
  let offset = 0;
  while (offset < data.length) {
    const length = Math.min(data.length - offset, 8192);
    const bufPtr = allocBuffer(wasm, length);
    if (bufPtr === 0) return;
    try {
      new Uint8Array(wasm.exports.memory.buffer, bufPtr, length).set(
        data.subarray(offset, offset + length),
      );
      wasm.exports.write(termPtr, bufPtr, length);
    } finally {
      freeBuffer(wasm, bufPtr, length);
    }
    offset += length;
    afterChunk?.();
  }
}
