// Queries in terminal output that WTerm answers itself, or prepares the core
// to answer, before handing a write to the core.
//
// Kitty uses xterm window reports (CSI 14 t, CSI 16 t) to discover the pixel
// geometry needed for image placement. The core intentionally does not know
// about the browser viewport, so these two queries are answered at the DOM
// boundary. Color queries (OSC 10, OSC 11) are answered by the core, from the
// theme colors WTerm syncs from the page's CSS before the write.

export type WindowSizeQueryState = 0 | 1 | 2 | 3 | 4 | 6;

export interface OutputQueries {
  /** The write may hold an OSC 10 or OSC 11 color query. */
  themeColors: boolean;
  /** Complete CSI 14 t and CSI 16 t window size queries, in order. */
  windowSizes: (14 | 16)[];
}

interface ScanResult extends OutputQueries {
  /** Matcher state for a window size query that the write left unfinished. */
  state: WindowSizeQueryState;
}

/** Whether the data may hold an OSC 10 or OSC 11 color query. */
function mayQueryThemeColors(data: string): boolean {
  return data.includes("\x1b]10;") || data.includes("\x1b]11;");
}

function findQueryPrefix(data: string, from: number): number {
  return data.indexOf("\x1b[1", from);
}

/** Query state for an `ESC` or `ESC [` that ends the data. */
function trailingQueryState(data: string): 0 | 1 | 2 {
  const n = data.length;
  if (n >= 1 && data.charCodeAt(n - 1) === 0x1b) return 1;
  if (
    n >= 2 &&
    data.charCodeAt(n - 2) === 0x1b &&
    data.charCodeAt(n - 1) === 0x5b
  )
    return 2;
  return 0;
}

/**
 * Advances the window size query matcher (`ESC [ 1 4 t`, `ESC [ 1 6 t`) by
 * one code unit, recording a query it completes.
 */
function stepWindowSizeQuery(
  state: WindowSizeQueryState,
  code: number,
  queries: (14 | 16)[],
): WindowSizeQueryState {
  const restart = code === 0x1b ? 1 : 0;
  switch (state) {
    case 1: // ESC
      return code === 0x5b ? 2 : restart;
    case 2: // ESC [
      return code === 0x31 ? 3 : restart;
    case 3: // ESC [ 1
      return code === 0x34 ? 4 : code === 0x36 ? 6 : restart;
    case 4:
    case 6:
      if (code === 0x74) queries.push(state === 4 ? 14 : 16);
      return restart;
    default:
      return restart;
  }
}

// Horspool shifts for the four five-byte sequences scanQueryBytes looks for,
// keyed by the last byte of the window: ESC [ 1 4 t, ESC [ 1 6 t,
// ESC ] 1 0 ; and ESC ] 1 1 ;.
const QUERY_SHIFT = new Uint8Array(256).fill(5);
for (const prefix of ["\x1b[14", "\x1b[16", "\x1b]10", "\x1b]11"])
  for (let k = 0; k < 4; k++) {
    const code = prefix.charCodeAt(k);
    QUERY_SHIFT[code] = Math.min(QUERY_SHIFT[code], 4 - k);
  }

/**
 * Finds the color and window size queries in raw output in one pass.
 * SGR-heavy output has an ESC every few bytes, so rather than visiting each
 * ESC this skips ahead by up to five bytes at a time (Horspool), and output
 * with no ESC at all costs a single indexOf.
 */
export function scanQueryBytes(
  data: Uint8Array,
  state: WindowSizeQueryState,
): ScanResult {
  const windowSizes: (14 | 16)[] = [];
  const n = data.length;
  // Finish a window size query the previous write cut short.
  let from = 0;
  while (state !== 0 && from < n)
    state = stepWindowSizeQuery(state, data[from++], windowSizes);
  let themeColors = false;
  let i = data.indexOf(0x1b);
  if (i < 0) return { themeColors, windowSizes, state };
  while (i + 4 < n) {
    const last = data[i + 4];
    if (
      (last === 0x74 || last === 0x3b) &&
      data[i] === 0x1b &&
      data[i + 2] === 0x31
    ) {
      const introducer = data[i + 1];
      const digit = data[i + 3];
      if (
        last === 0x74 &&
        introducer === 0x5b &&
        (digit === 0x34 || digit === 0x36) &&
        // A query the continuation above already completed.
        i >= from
      )
        windowSizes.push(digit === 0x34 ? 14 : 16);
      else if (
        last === 0x3b &&
        introducer === 0x5d &&
        (digit === 0x30 || digit === 0x31)
      )
        themeColors = true;
    }
    i += QUERY_SHIFT[last];
  }
  if (state === 0) {
    // A query prefix that ends the data resumes in the next write.
    for (let k = Math.max(from, n - 4); k < n; k++) {
      if (data[k] !== 0x1b) continue;
      const length = n - k;
      if (length >= 2 && data[k + 1] !== 0x5b) continue;
      if (length >= 3 && data[k + 2] !== 0x31) continue;
      if (length === 4 && data[k + 3] !== 0x34 && data[k + 3] !== 0x36)
        continue;
      state =
        length === 4 ? (data[k + 3] === 0x34 ? 4 : 6) : (length as 1 | 2 | 3);
      break;
    }
  }
  return { themeColors, windowSizes, state };
}

/** Like scanQueryBytes, for text writes. */
export function scanQueryText(
  data: string,
  state: WindowSizeQueryState,
): ScanResult {
  const windowSizes: (14 | 16)[] = [];
  let index = 0;
  while (index < data.length) {
    if (state === 0) {
      // Skip ordinary output in bulk, jumping straight to `ESC [ 1`.
      const found = findQueryPrefix(data, index);
      if (found < 0) {
        // A prefix cut by the end of this write resumes in the next one.
        state = trailingQueryState(data);
        break;
      }
      state = 3;
      index = found + 3;
      continue;
    }
    state = stepWindowSizeQuery(state, data.charCodeAt(index++), windowSizes);
  }
  return { themeColors: mayQueryThemeColors(data), windowSizes, state };
}
