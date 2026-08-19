import type { WTerm } from "@wterm/dom";
import {
  compileMatcher,
  findAllMatches,
  getMaxScanMatches,
  iterRows,
} from "./engine.js";

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
}

export interface SearchMatch {
  // row: negative = scrollback (-1 is most recent scrollback line), 0+ = grid row
  row: number;
  col: number;
  length: number;
  text: string;
}

interface Cursor {
  row: number;
  col: number;
}

export class Search {
  private _term: WTerm;
  private _cursor: Cursor | null = null;

  constructor(term: WTerm) {
    if (!term.bridge) {
      throw new Error("wterm: search requires an initialized terminal");
    }
    this._term = term;
  }

  findNext(query: string, opts: SearchOptions = {}): SearchMatch | null {
    if (!query) {
      return null;
    }

    const bridge = this._term.bridge;
    if (!bridge) {
      throw new Error("wterm: search requires an initialized terminal");
    }

    const matcher = compileMatcher(query, opts);
    const maxScan = getMaxScanMatches();
    let scanned = 0;

    for (const row of iterRows(bridge)) {
      if (this._cursor && row.row < this._cursor.row) {
        continue;
      }

      matcher.lastIndex = 0;
      while (true) {
        const match = matcher.exec(row.text);
        if (!match) {
          break;
        }

        scanned++;
        if (scanned > maxScan) {
          return null;
        }

        if (
          this._cursor &&
          row.row === this._cursor.row &&
          match.index <= this._cursor.col
        ) {
          if (matcher.lastIndex === match.index) {
            matcher.lastIndex++;
          }
          continue;
        }

        const found: SearchMatch = {
          row: row.row,
          col: match.index,
          length: match[0].length,
          text: match[0],
        };

        this._cursor = {
          row: found.row,
          col: found.col + found.length,
        };

        return found;
      }
    }

    return null;
  }

  findPrevious(query: string, opts: SearchOptions = {}): SearchMatch | null {
    if (!query) {
      return null;
    }

    const bridge = this._term.bridge;
    if (!bridge) {
      throw new Error("wterm: search requires an initialized terminal");
    }

    const matcher = compileMatcher(query, opts);
    const maxScan = getMaxScanMatches();
    let scanned = 0;

    let candidate: SearchMatch | null = null;

    for (const row of iterRows(bridge)) {
      matcher.lastIndex = 0;

      while (true) {
        const match = matcher.exec(row.text);
        if (!match) {
          break;
        }

        scanned++;
        if (scanned > maxScan) {
          return null;
        }

        const found: SearchMatch = {
          row: row.row,
          col: match.index,
          length: match[0].length,
          text: match[0],
        };

        const isBeforeCursor =
          this._cursor == null ||
          found.row < this._cursor.row ||
          (found.row === this._cursor.row && found.col < this._cursor.col);

        if (isBeforeCursor) {
          candidate = found;
        }

        if (matcher.lastIndex === match.index) {
          matcher.lastIndex++;
        }
      }
    }

    if (!candidate) {
      return null;
    }

    this._cursor = { row: candidate.row, col: candidate.col };
    return candidate;
  }

  findAll(query: string, opts: SearchOptions = {}): SearchMatch[] {
    if (!query) {
      return [];
    }

    const bridge = this._term.bridge;
    if (!bridge) {
      throw new Error("wterm: search requires an initialized terminal");
    }

    const matcher = compileMatcher(query, opts);
    return findAllMatches(bridge, matcher);
  }

  reset(): void {
    this._cursor = null;
  }
}
