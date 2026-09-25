import type { TerminalCore } from "@wterm/core";

export interface SearchOptions {
  /** Defaults to false. Uses locale-independent, per-code-point lowercase. */
  caseSensitive?: boolean;
}

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  /** Number of matches found so far, up to 10,000. */
  count: number;
  /** Zero-based match index, or -1 when there are no matches. */
  activeIndex: number;
  searching: boolean;
  /** More than 10,000 matches exist; narrow the query to see more. */
  limited: boolean;
}

interface Position {
  row: number;
  col: number;
  endCol: number;
}

/** Internal coordinates, relative to the oldest currently retained row. */
export interface SearchMatch {
  start: Position;
  end: Position;
}

function fold(text: string, caseSensitive: boolean): string {
  return caseSensitive
    ? text
    : Array.from(text, (char) => char.toLowerCase()).join("");
}

/** Streams cells without materializing history or an arbitrarily long line. */
export function* scanSearch(
  core: TerminalCore,
  query: string,
  caseSensitive: boolean,
): Generator<SearchMatch | null> {
  const needle = fold(query, caseSensitive);
  if (!needle) return;
  const prefix = new Uint32Array(needle.length);
  for (let i = 1, length = 0; i < needle.length; i++) {
    while (length > 0 && needle[i] !== needle[length])
      length = prefix[length - 1];
    if (needle[i] === needle[length]) length++;
    prefix[i] = length;
  }
  const positions = new Array<Position>(needle.length);
  const history = core.getScrollbackCount();
  let matched = 0;
  let index = 0;
  let work = 0;
  let previousWrap = false;
  let previousMatch: SearchMatch | undefined;
  for (let row = 0; row < history + core.getRows(); row++) {
    const offset = history - 1 - row;
    const metadata =
      row < history
        ? core.getScrollbackRowMetadata?.(offset)
        : core.getRowMetadata?.(row - history);
    if (!previousWrap || !metadata?.continuesPrevious) matched = 0;
    previousWrap = metadata?.wrapsToNext ?? false;
    const cols =
      row < history ? core.getScrollbackLineLen(offset) : core.getCols();
    for (let col = 0; col < cols; col++) {
      // Yield even for blank/continuation cells, so empty history is bounded too.
      if (++work >= 256) {
        work = 0;
        yield null;
      }
      const cell =
        row < history
          ? core.getScrollbackCell(offset, col)
          : core.getCell(row - history, col);
      if (cell.width === 0 || cell.spacerHead) continue;
      const text = fold(
        cell.chars ?? String.fromCodePoint(cell.char || 32),
        caseSensitive,
      );
      const position = {
        row,
        col,
        endCol: Math.min(cols, col + (cell.width ?? 1)),
      };
      for (let unit = 0; unit < text.length; unit++) {
        if (++work >= 256) {
          work = 0;
          yield null;
        }
        positions[index++ % needle.length] = position;
        while (matched > 0 && text[unit] !== needle[matched])
          matched = prefix[matched - 1];
        if (text[unit] === needle[matched]) matched++;
        if (matched === needle.length) {
          const match = {
            start: positions[(index - needle.length) % needle.length],
            end: position,
          };
          // Several code points in one grapheme may match the same cell.
          if (
            !previousMatch ||
            previousMatch.start.row !== match.start.row ||
            previousMatch.start.col !== match.start.col ||
            previousMatch.end.row !== match.end.row ||
            previousMatch.end.endCol !== match.end.endCol
          ) {
            yield match;
            previousMatch = match;
          }
          matched = prefix[matched - 1];
        }
      }
    }
    if (++work >= 256) {
      work = 0;
      yield null;
    }
  }
}

/** Owns cancellation and small scan slices; WTerm resumes only after painting. */
export class SearchController {
  matches: SearchMatch[] = [];
  private state: SearchState = {
    query: "",
    caseSensitive: false,
    count: 0,
    activeIndex: -1,
    searching: false,
    limited: false,
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scan: Generator<SearchMatch | null> | null = null;
  private pending = false;
  private revealFirst = false;

  constructor(private changed: (reveal: boolean) => void) {}

  snapshot(): SearchState {
    return { ...this.state };
  }

  search(query: string, options: SearchOptions): void {
    if (query.length > 1024)
      throw new RangeError("Search query exceeds 1,024 UTF-16 code units");
    this.state.query = query;
    this.state.caseSensitive = options.caseSensitive ?? false;
    this.revealFirst = true;
    this.invalidate();
  }

  invalidate(): void {
    this.cancel();
    this.matches = [];
    this.state.count = 0;
    this.state.activeIndex = -1;
    this.state.limited = false;
    this.pending = this.state.searching = this.state.query.length > 0;
    this.changed(false);
  }

  resume(core: TerminalCore): void {
    if (!this.pending) return;
    this.pending = false;
    const scan = (this.scan = scanSearch(
      core,
      this.state.query,
      this.state.caseSensitive,
    ));
    const tick = () => {
      this.timer = null;
      const deadline = performance.now() + 4;
      let done = false;
      let batches = 0;
      do {
        const next = scan.next();
        if (next.done) {
          done = true;
          break;
        }
        if (next.value) {
          if (this.matches.length === 10000) {
            this.state.limited = true;
            done = true;
            break;
          }
          this.matches.push(next.value);
        } else {
          batches++;
        }
      } while (batches < 32 && performance.now() < deadline);
      this.state.count = this.matches.length;
      const reveal = this.revealFirst && this.matches.length > 0;
      if (this.matches.length && this.state.activeIndex === -1)
        this.state.activeIndex = 0;
      if (reveal) this.revealFirst = false;
      this.state.searching = !done;
      if (done) {
        scan.return(undefined);
        this.scan = null;
      }
      this.changed(reveal);
      // A host callback can cancel, replace the query, write, or destroy WTerm.
      if (this.scan === scan) this.timer = setTimeout(tick, 0);
    };
    this.timer = setTimeout(tick, 0);
  }

  navigate(direction: 1 | -1): boolean {
    if (!this.matches.length) return false;
    this.state.activeIndex =
      (this.state.activeIndex + direction + this.matches.length) %
      this.matches.length;
    this.revealFirst = false;
    this.changed(true);
    return true;
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.scan?.return(undefined);
    this.scan = null;
    this.pending = false;
    this.matches = [];
    this.state.count = 0;
    this.state.activeIndex = -1;
    this.state.searching = false;
    this.state.limited = false;
  }
}
