// Window size queries in terminal output, which WTerm answers itself.
//
// Kitty uses xterm window reports (CSI 14 t, CSI 16 t) to discover the pixel
// geometry needed for image placement. The core intentionally does not know
// about the browser viewport, so these two queries are answered at the DOM
// boundary. Theme color queries are recognized by theme-query.ts.

export type WindowSizeQueryState = 0 | 1 | 2 | 3 | 4 | 6;

interface ScanResult {
  /** Complete CSI 14 t and CSI 16 t window size queries, in order. */
  windowSizes: (14 | 16)[];
  /** Matcher state for a window size query that the write left unfinished. */
  state: WindowSizeQueryState;
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

// Horspool shifts for the two five-byte sequences scanWindowSizeBytes looks
// for, keyed by the last byte of the window: ESC [ 1 4 t and ESC [ 1 6 t.
const QUERY_SHIFT = new Uint8Array(256).fill(5);
for (const prefix of ["\x1b[14", "\x1b[16"])
  for (let k = 0; k < 4; k++) {
    const code = prefix.charCodeAt(k);
    QUERY_SHIFT[code] = Math.min(QUERY_SHIFT[code], 4 - k);
  }

/**
 * Finds the window size queries in raw output.
 * SGR-heavy output has an ESC every few bytes, so rather than visiting each
 * ESC this skips ahead by up to five bytes at a time (Horspool), and output
 * with no ESC at all costs a single indexOf.
 */
export function scanWindowSizeBytes(
  data: Uint8Array,
  state: WindowSizeQueryState,
): ScanResult {
  const windowSizes: (14 | 16)[] = [];
  const n = data.length;
  // Finish a window size query the previous write cut short.
  let from = 0;
  while (state !== 0 && from < n)
    state = stepWindowSizeQuery(state, data[from++], windowSizes);
  let i = data.indexOf(0x1b);
  if (i < 0) return { windowSizes, state };
  while (i + 4 < n) {
    const last = data[i + 4];
    if (
      last === 0x74 &&
      data[i] === 0x1b &&
      data[i + 1] === 0x5b &&
      data[i + 2] === 0x31 &&
      (data[i + 3] === 0x34 || data[i + 3] === 0x36) &&
      // A query the continuation above already completed.
      i >= from
    )
      windowSizes.push(data[i + 3] === 0x34 ? 14 : 16);
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
  return { windowSizes, state };
}

/** Like scanWindowSizeBytes, for text writes. */
export function scanWindowSizeText(
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
  return { windowSizes, state };
}
