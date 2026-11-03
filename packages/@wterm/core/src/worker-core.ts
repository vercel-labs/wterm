import type {
  CellData,
  CursorState,
  MouseEncoding,
  TerminalCore,
  TerminalResourceState,
  UnhandledSequence,
} from "./terminal-core.js";
import {
  CELL_WORDS,
  CLUSTER_BIT,
  NO_RGB,
  type CoreModes,
  type CoreUpdate,
  type FromWorker,
  type ToWorker,
} from "./worker-protocol.js";

const MAX_COLS = 1024;
const MAX_ROWS = 512;
const BLANK: CellData = { char: 32, fg: 256, bg: 256, flags: 0, width: 1 };

interface Line {
  cells: Uint32Array;
  clusters: Map<number, string> | null;
}

type Link = { linkUri: string; linkId?: string; linkKey: string };

export interface WorkerCoreOptions {
  /** URL of the built-in core's WASM; the embedded binary is used when omitted. */
  wasmUrl?: string;
  /** A worker running `@wterm/core`'s core worker, for bundlers that need it built explicitly. */
  worker?: Worker;
}

/**
 * The built-in core running in a Web Worker. Parsing leaves the main thread,
 * so many busy terminals can use more than one CPU core. Reads come from a
 * mirror the worker refreshes after each batch of writes; effects of a write
 * (cells, replies, titles, bells) arrive asynchronously through the update
 * listener instead of before `writeString` returns.
 */
export class WorkerCore implements TerminalCore {
  private worker: Worker;
  private cols = 0;
  private rows = 0;
  private grid = new Uint32Array(0);
  private gridClusters = new Map<number, string>();
  private dirty = new Uint8Array(0);
  private cursor: CursorState = { row: 0, col: 0, visible: true };
  private modes: CoreModes = {
    cursorKeysApp: false,
    bracketedPaste: false,
    usingAltScreen: false,
    mouseTracking: 0,
    mouseSgr: false,
    mouseEncoding: null,
    focusEvents: false,
    synchronizedOutput: false,
    synchronizedOutputGeneration: 0,
    kittyKeyboardFlags: 0,
  };
  private title: string | null = null;
  private bells = 0;
  private responses: string[] = [];
  private resources: TerminalResourceState = {};
  private scrollback: Line[] = [];
  private scrollbackDiscarded = 0;
  private links = new Map<number, Link>();
  private listener: (() => void) | null = null;

  static async load(options: WorkerCoreOptions = {}): Promise<WorkerCore> {
    const worker =
      options.worker ??
      new Worker(new URL("./core-worker.js", import.meta.url), {
        type: "module",
      });
    const core = new WorkerCore(worker);
    await new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<FromWorker>) => {
        if (event.data.t === "ready") resolve();
        else if (event.data.t === "error")
          reject(new Error(event.data.message));
        else return;
        worker.removeEventListener("message", onMessage);
      };
      worker.addEventListener("message", onMessage);
      // A worker that fails to load or throws before replying never posts.
      worker.addEventListener(
        "error",
        (event) => reject(new Error(event.message || "worker failed to start")),
        { once: true },
      );
      core.post({ t: "load", wasmUrl: options.wasmUrl });
    });
    worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
      if (event.data.t === "update") core.apply(event.data);
    });
    return core;
  }

  private constructor(worker: Worker) {
    this.worker = worker;
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  /** Stops the worker; the core cannot be used afterwards. */
  dispose(): void {
    this.listener = null;
    this.worker.terminate();
  }

  setUpdateListener(listener: (() => void) | null): void {
    this.listener = listener;
  }

  private resizeMirror(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.grid = new Uint32Array(cols * rows * CELL_WORDS);
    this.gridClusters.clear();
    this.dirty = new Uint8Array(rows).fill(1);
  }

  private apply(update: CoreUpdate): void {
    this.resizeMirror(update.cols, update.rows);
    for (const [index, uri, id] of update.links)
      this.links.set(index, {
        linkUri: uri,
        linkId: id,
        linkKey: id ? `e\0${id}\0${uri}` : `b\0${index}`,
      });
    const rowWords = update.cols * CELL_WORDS;
    for (let i = 0; i < update.dirtyRows.length; i++) {
      const row = update.dirtyRows[i];
      const src = update.cells.subarray(i * rowWords, (i + 1) * rowWords);
      this.grid.set(src, row * rowWords);
      for (let col = 0; col < update.cols; col++) {
        const key = row * update.cols + col;
        const char = src[col * CELL_WORDS];
        if (char & CLUSTER_BIT)
          this.gridClusters.set(key, update.clusters[char & ~CLUSTER_BIT]);
        else this.gridClusters.delete(key);
      }
      this.dirty[row] = 1;
    }

    const sb = update.scrollback;
    if (sb.reset) this.scrollback = [];
    let o = 0;
    for (const len of sb.lineLengths) {
      const cells = sb.cells.slice(o, o + len * CELL_WORDS);
      let clusters: Map<number, string> | null = null;
      for (let col = 0; col < len; col++) {
        const char = cells[col * CELL_WORDS];
        if (char & CLUSTER_BIT)
          (clusters ??= new Map()).set(
            col,
            update.clusters[char & ~CLUSTER_BIT],
          );
      }
      this.scrollback.push({ cells, clusters });
      o += len * CELL_WORDS;
    }
    if (this.scrollback.length > sb.count)
      this.scrollback.splice(0, this.scrollback.length - sb.count);
    this.scrollbackDiscarded = sb.discarded;

    this.cursor = update.cursor;
    this.modes = update.modes;
    if (update.title !== null) this.title = update.title;
    this.bells += update.bells;
    this.responses.push(...update.responses);
    this.resources = update.resources;
    this.listener?.();
  }

  private unpack(
    cells: Uint32Array,
    o: number,
    cluster: string | undefined,
  ): CellData {
    const char = cells[o];
    const w1 = cells[o + 1];
    const w2 = cells[o + 2];
    const cell: CellData = {
      char: char & CLUSTER_BIT ? (cluster?.codePointAt(0) ?? 32) : char,
      fg: w1 & 0xffff,
      bg: w1 >>> 16,
      flags: w2 & 0xff,
      width: (w2 >>> 8) & 0xff,
    };
    if (cluster !== undefined) cell.chars = cluster;
    if (cells[o + 3] !== NO_RGB) cell.fgRgb = cells[o + 3];
    if (cells[o + 4] !== NO_RGB) cell.bgRgb = cells[o + 4];
    const link = this.links.get(w2 >>> 16);
    if (link) Object.assign(cell, link);
    return cell;
  }

  // -- TerminalCore --

  init(cols: number, rows: number): void {
    this.links.clear();
    this.scrollback = [];
    this.title = null;
    this.responses = [];
    this.bells = 0;
    this.resizeMirror(clamp(cols, MAX_COLS), clamp(rows, MAX_ROWS));
    this.post({ t: "init", cols, rows });
  }

  resize(cols: number, rows: number): void {
    this.resizeMirror(clamp(cols, MAX_COLS), clamp(rows, MAX_ROWS));
    this.post({ t: "resize", cols, rows });
  }

  /** Lines of history to keep; extra lines are dropped from the oldest end. */
  setScrollbackLines(lines: number): void {
    if (!Number.isInteger(lines) || lines < 0 || lines > 0xffffffff)
      throw new RangeError(`Invalid scrollback line count: ${lines}`);
    this.post({ t: "scrollbackLines", lines });
  }

  writeString(str: string): void {
    this.post({ t: "write", data: str });
  }

  writeRaw(data: Uint8Array): void {
    // Copy so the caller may reuse its buffer; the copy moves without cloning.
    const copy = data.slice();
    this.post({ t: "write", data: copy }, [copy.buffer]);
  }

  getCell(row: number, col: number): CellData {
    if (row >= this.rows || col >= this.cols) return BLANK;
    const key = row * this.cols + col;
    return this.unpack(this.grid, key * CELL_WORDS, this.gridClusters.get(key));
  }

  isDirtyRow(row: number): boolean {
    return this.dirty[row] === 1;
  }

  clearDirty(): void {
    this.dirty.fill(0);
  }

  getCols(): number {
    return this.cols;
  }

  getRows(): number {
    return this.rows;
  }

  getCursor(): CursorState {
    return this.cursor;
  }

  cursorKeysApp(): boolean {
    return this.modes.cursorKeysApp;
  }

  bracketedPaste(): boolean {
    return this.modes.bracketedPaste;
  }

  usingAltScreen(): boolean {
    return this.modes.usingAltScreen;
  }

  mouseTracking(): 0 | 1000 | 1002 | 1003 {
    return this.modes.mouseTracking;
  }

  mouseSgr(): boolean {
    return this.modes.mouseSgr;
  }

  mouseEncoding(): MouseEncoding | null {
    return this.modes.mouseEncoding;
  }

  focusEvents(): boolean {
    return this.modes.focusEvents;
  }

  synchronizedOutput(): boolean {
    return this.modes.synchronizedOutput;
  }

  synchronizedOutputGeneration(): number {
    return this.modes.synchronizedOutputGeneration;
  }

  kittyKeyboardFlags(): number {
    return this.modes.kittyKeyboardFlags;
  }

  getTitle(): string | null {
    const title = this.title;
    this.title = null;
    return title;
  }

  getBellCount(): number {
    const bells = this.bells;
    this.bells = 0;
    return bells;
  }

  getResponse(): string | null {
    return this.responses.shift() ?? null;
  }

  getResourceState(): TerminalResourceState {
    return this.resources;
  }

  getScrollbackCount(): number {
    return this.scrollback.length;
  }

  getScrollbackDiscardedCount(): number {
    return this.scrollbackDiscarded;
  }

  getScrollbackCell(offset: number, col: number): CellData {
    const line = this.scrollback[this.scrollback.length - 1 - offset];
    if (!line || col * CELL_WORDS >= line.cells.length) return BLANK;
    return this.unpack(line.cells, col * CELL_WORDS, line.clusters?.get(col));
  }

  getScrollbackLineLen(offset: number): number {
    const line = this.scrollback[this.scrollback.length - 1 - offset];
    return line ? line.cells.length / CELL_WORDS : 0;
  }

  /** Unsupported off the main thread; debug tooling sees no entries. */
  getUnhandledSequences(): UnhandledSequence[] {
    return [];
  }
}

function clamp(value: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(value) || 1));
}
