/// <reference lib="webworker" />
// Runs a WasmBridge off the main thread for WorkerCore. Each batch of writes
// is answered with one update holding everything the main thread mirrors.
import { WasmBridge } from "./wasm-bridge.js";
import {
  CELL_WORDS,
  packCell,
  type CoreUpdate,
  type FromWorker,
  type ToWorker,
} from "./worker-protocol.js";

let bridge: WasmBridge | null = null;
let sentLinks = new Map<number, string>();
let scrollbackTotal = 0;
let scrollbackReset = true;
let allDirty = true;
let pending = false;

const post = (message: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

function noteLink(
  b: WasmBridge,
  index: number,
  links: CoreUpdate["links"],
  uri?: string,
  id?: string,
) {
  if (
    index === 0 ||
    uri === undefined ||
    sentLinks.get(index) === `${id}\0${uri}`
  )
    return;
  sentLinks.set(index, `${id}\0${uri}`);
  links.push([index, uri, id]);
}

function buildUpdate(b: WasmBridge): {
  update: CoreUpdate;
  transfer: Transferable[];
} {
  const cols = b.getCols();
  const rows = b.getRows();
  const dirty: number[] = [];
  for (let r = 0; r < rows; r++) if (allDirty || b.isDirtyRow(r)) dirty.push(r);
  allDirty = false;
  const clusters: string[] = [];
  const links: CoreUpdate["links"] = [];
  const cells = new Uint32Array(dirty.length * cols * CELL_WORDS);
  let o = 0;
  for (const r of dirty) {
    for (let c = 0; c < cols; c++, o += CELL_WORDS) {
      const cell = b.getCell(r, c);
      const linkIndex = b.getCellLinkIndex(r, c);
      noteLink(b, linkIndex, links, cell.linkUri, cell.linkId);
      packCell({ ...cell, linkIndex }, cells, o, clusters);
    }
  }
  b.clearDirty();

  // Scrollback only grows by pushes; anything else resends it whole.
  const count = b.getScrollbackCount();
  const discarded = b.getScrollbackDiscardedCount?.() ?? 0;
  const total = count + discarded;
  const reset = scrollbackReset || total < scrollbackTotal;
  const added = reset ? count : Math.min(count, total - scrollbackTotal);
  scrollbackTotal = total;
  scrollbackReset = false;
  const lineLengths = new Uint16Array(added);
  let words = 0;
  for (let i = 0; i < added; i++) {
    lineLengths[i] = b.getScrollbackLineLen(added - 1 - i);
    words += lineLengths[i] * CELL_WORDS;
  }
  const sbCells = new Uint32Array(words);
  o = 0;
  for (let i = 0; i < added; i++) {
    const offset = added - 1 - i;
    for (let c = 0; c < lineLengths[i]; c++, o += CELL_WORDS) {
      const cell = b.getScrollbackCell(offset, c);
      const linkIndex = b.getScrollbackLinkIndex(offset, c);
      noteLink(b, linkIndex, links, cell.linkUri, cell.linkId);
      packCell({ ...cell, linkIndex }, sbCells, o, clusters);
    }
  }

  const responses: string[] = [];
  for (let r = b.getResponse(); r !== null; r = b.getResponse())
    responses.push(r);
  const update: CoreUpdate = {
    t: "update",
    cols,
    rows,
    cells,
    dirtyRows: Uint16Array.from(dirty),
    cursor: b.getCursor(),
    modes: {
      cursorKeysApp: b.cursorKeysApp(),
      bracketedPaste: b.bracketedPaste(),
      usingAltScreen: b.usingAltScreen(),
      mouseTracking: b.mouseTracking(),
      mouseSgr: b.mouseSgr(),
      mouseEncoding: b.mouseEncoding(),
      focusEvents: b.focusEvents(),
      synchronizedOutput: b.synchronizedOutput(),
      synchronizedOutputGeneration: b.synchronizedOutputGeneration(),
      kittyKeyboardFlags: b.kittyKeyboardFlags(),
    },
    title: b.getTitle(),
    bells: b.getBellCount(),
    responses,
    resources: b.getResourceState(),
    scrollback: { count, discarded, reset, cells: sbCells, lineLengths },
    links,
    clusters,
  };
  return { update, transfer: [cells.buffer, sbCells.buffer] };
}

// Writes that arrive together are parsed before one update goes back.
function schedule(): void {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    if (!bridge) return;
    const { update, transfer } = buildUpdate(bridge);
    post(update, transfer);
  });
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    if (msg.t === "load") {
      bridge ??= await WasmBridge.load(msg.wasmUrl);
      post({ t: "ready" });
      return;
    }
    if (msg.t === "init") {
      if (!bridge) return;
      bridge.init(msg.cols, msg.rows);
      sentLinks = new Map();
      scrollbackReset = true;
      allDirty = true;
      schedule();
      return;
    }
    if (!bridge) return;
    if (msg.t === "write") {
      if (typeof msg.data === "string") bridge.writeString(msg.data);
      else bridge.writeRaw(msg.data);
    } else if (msg.t === "resize") {
      bridge.resize(msg.cols, msg.rows);
      scrollbackReset = true;
      allDirty = true;
    }
    schedule();
  } catch (error) {
    post({ t: "error", message: String((error as Error)?.message ?? error) });
  }
};
