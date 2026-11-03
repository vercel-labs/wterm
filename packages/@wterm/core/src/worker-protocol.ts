import type {
  CellData,
  CursorState,
  MouseEncoding,
  TerminalResourceState,
} from "./terminal-core.js";

/** 32-bit words per packed cell. */
export const CELL_WORDS = 5;
/** Marks an absent 24-bit color in a packed cell. */
export const NO_RGB = 0xffffffff;
/** Set in the char word when the low bits index the update's cluster table. */
export const CLUSTER_BIT = 0x80000000;

export type ToWorker =
  | { t: "load"; wasmUrl?: string }
  | { t: "init"; cols: number; rows: number }
  | { t: "write"; data: string | Uint8Array }
  | { t: "resize"; cols: number; rows: number }
  | { t: "scrollbackLines"; lines: number };

export interface CoreModes {
  cursorKeysApp: boolean;
  bracketedPaste: boolean;
  usingAltScreen: boolean;
  mouseTracking: 0 | 1000 | 1002 | 1003;
  mouseSgr: boolean;
  mouseEncoding: MouseEncoding | null;
  focusEvents: boolean;
  synchronizedOutput: boolean;
  synchronizedOutputGeneration: number;
  kittyKeyboardFlags: number;
}

export interface CoreUpdate {
  t: "update";
  cols: number;
  rows: number;
  /** Packed cells for `dirtyRows`, in order, `cols * CELL_WORDS` words each. */
  cells: Uint32Array;
  dirtyRows: Uint16Array;
  cursor: CursorState;
  modes: CoreModes;
  /** A changed title, or null when it did not change. */
  title: string | null;
  bells: number;
  responses: string[];
  resources: TerminalResourceState;
  scrollback: {
    count: number;
    discarded: number;
    /** Replace the mirror instead of appending, newest line last. */
    reset: boolean;
    /** Packed lines, oldest first; `lineLengths[i]` cells each. */
    cells: Uint32Array;
    lineLengths: Uint16Array;
  };
  /** Link table entries first referenced by this update. */
  links: [index: number, uri: string, id: string | undefined][];
  /** Grapheme clusters referenced through CLUSTER_BIT in this update. */
  clusters: string[];
}

export type FromWorker =
  { t: "ready" } | { t: "error"; message: string } | CoreUpdate;

/** Writes one cell into `out` at word offset `o`, returning its link index. */
export function packCell(
  cell: CellData & { linkIndex?: number },
  out: Uint32Array,
  o: number,
  clusters: string[],
): void {
  out[o] =
    cell.chars !== undefined
      ? (CLUSTER_BIT | (clusters.push(cell.chars) - 1)) >>> 0
      : cell.char;
  out[o + 1] = (cell.fg & 0xffff) | ((cell.bg & 0xffff) << 16);
  out[o + 2] =
    (cell.flags & 0xff) |
    (((cell.width ?? 1) & 0xff) << 8) |
    (((cell.linkIndex ?? 0) & 0xffff) << 16);
  out[o + 3] = cell.fgRgb ?? NO_RGB;
  out[o + 4] = cell.bgRgb ?? NO_RGB;
}
