import type { CellData, WasmBridge } from "@wterm/core";
import { DEFAULT_URL_PATTERN, findUrls, type NormalizedLinkify } from "./linkify.js";

const DEFAULT_COLOR = 256;
const FLAG_BOLD = 0x01;
const FLAG_DIM = 0x02;
const FLAG_ITALIC = 0x04;
const FLAG_UNDERLINE = 0x08;
const FLAG_REVERSE = 0x20;
const FLAG_INVISIBLE = 0x40;
const FLAG_STRIKETHROUGH = 0x80;

function colorToCSS(index: number): string | null {
  if (index === DEFAULT_COLOR) return null;
  if (index < 16) return `var(--term-color-${index})`;
  if (index < 232) {
    const n = index - 16;
    const r = Math.floor(n / 36) * 51;
    const g = (Math.floor(n / 6) % 6) * 51;
    const b = (n % 6) * 51;
    return `rgb(${r},${g},${b})`;
  }
  const level = (index - 232) * 10 + 8;
  return `rgb(${level},${level},${level})`;
}

function buildCellStyle(fg: number, bg: number, flags: number): string {
  let fgC = fg,
    bgC = bg;
  if (flags & FLAG_REVERSE) {
    const tmp = fgC;
    fgC = bgC;
    bgC = tmp;
    if (fgC === DEFAULT_COLOR) fgC = 0;
    if (bgC === DEFAULT_COLOR) bgC = 7;
  }

  const fgCSS = colorToCSS(fgC);
  const bgCSS = colorToCSS(bgC);

  let style = "";
  if (fgCSS) style += `color:${fgCSS};`;
  if (bgCSS) style += `background:${bgCSS};`;
  if (flags & FLAG_BOLD) style += "font-weight:bold;";
  if (flags & FLAG_DIM) style += "opacity:0.5;";
  if (flags & FLAG_ITALIC) style += "font-style:italic;";

  const decorations: string[] = [];
  if (flags & FLAG_UNDERLINE) decorations.push("underline");
  if (flags & FLAG_STRIKETHROUGH) decorations.push("line-through");
  if (decorations.length) style += `text-decoration:${decorations.join(" ")};`;

  if (flags & FLAG_INVISIBLE) style += "visibility:hidden;";
  return style;
}

function appendRun(parent: HTMLElement, text: string, style: string): void {
  const span = document.createElement("span");
  if (style) span.style.cssText = style;
  span.textContent = text;
  parent.appendChild(span);
}

function resolveColors(
  fg: number,
  bg: number,
  flags: number,
): { fg: string; bg: string } {
  let fgC = fg,
    bgC = bg;
  if (flags & FLAG_REVERSE) {
    [fgC, bgC] = [bgC, fgC];
    if (fgC === DEFAULT_COLOR) fgC = 0;
    if (bgC === DEFAULT_COLOR) bgC = 7;
  }
  return {
    fg: colorToCSS(fgC) || "var(--term-fg)",
    bg: colorToCSS(bgC) || "var(--term-bg)",
  };
}

function getBlockBackground(cp: number, fg: string, bg: string): string {
  switch (cp) {
    case 0x2580:
      return `linear-gradient(${fg} 50%,${bg} 50%)`;
    case 0x2581:
      return `linear-gradient(${bg} 87.5%,${fg} 87.5%)`;
    case 0x2582:
      return `linear-gradient(${bg} 75%,${fg} 75%)`;
    case 0x2583:
      return `linear-gradient(${bg} 62.5%,${fg} 62.5%)`;
    case 0x2584:
      return `linear-gradient(${bg} 50%,${fg} 50%)`;
    case 0x2585:
      return `linear-gradient(${bg} 37.5%,${fg} 37.5%)`;
    case 0x2586:
      return `linear-gradient(${bg} 25%,${fg} 25%)`;
    case 0x2587:
      return `linear-gradient(${bg} 12.5%,${fg} 12.5%)`;
    case 0x2588:
      return fg;
    case 0x2589:
      return `linear-gradient(to right,${fg} 87.5%,${bg} 87.5%)`;
    case 0x258a:
      return `linear-gradient(to right,${fg} 75%,${bg} 75%)`;
    case 0x258b:
      return `linear-gradient(to right,${fg} 62.5%,${bg} 62.5%)`;
    case 0x258c:
      return `linear-gradient(to right,${fg} 50%,${bg} 50%)`;
    case 0x258d:
      return `linear-gradient(to right,${fg} 37.5%,${bg} 37.5%)`;
    case 0x258e:
      return `linear-gradient(to right,${fg} 25%,${bg} 25%)`;
    case 0x258f:
      return `linear-gradient(to right,${fg} 12.5%,${bg} 12.5%)`;
    case 0x2590:
      return `linear-gradient(to right,${bg} 50%,${fg} 50%)`;
    case 0x2591:
      return `color-mix(in srgb,${fg} 25%,${bg})`;
    case 0x2592:
      return `color-mix(in srgb,${fg} 50%,${bg})`;
    case 0x2593:
      return `color-mix(in srgb,${fg} 75%,${bg})`;
    case 0x2594:
      return `linear-gradient(${fg} 12.5%,${bg} 12.5%)`;
    case 0x2595:
      return `linear-gradient(to right,${bg} 87.5%,${fg} 87.5%)`;
    default: {
      const QUADRANTS: Record<number, [boolean, boolean, boolean, boolean]> = {
        0x2596: [false, false, true, false],
        0x2597: [false, false, false, true],
        0x2598: [true, false, false, false],
        0x2599: [true, false, true, true],
        0x259a: [true, false, false, true],
        0x259b: [true, true, true, false],
        0x259c: [true, true, false, true],
        0x259d: [false, true, false, false],
        0x259e: [false, true, true, false],
        0x259f: [false, true, true, true],
      };
      const q = QUADRANTS[cp];
      if (!q) return fg;
      const [tl, tr, bl, br] = q;
      if (tl && tr && bl && br) return fg;
      const layers: string[] = [];
      const POS = ["0 0", "100% 0", "0 100%", "100% 100%"];
      q.forEach((filled, i) => {
        if (filled)
          layers.push(
            `linear-gradient(${fg},${fg}) ${POS[i]}/50% 50% no-repeat`,
          );
      });
      layers.push(bg);
      return layers.join(",");
    }
  }
}

export class Renderer {
  private container: HTMLElement;
  private rows = 0;
  private cols = 0;

  private rowEls: HTMLDivElement[] = [];
  private prevCursorRow = -1;
  private prevCursorCol = -1;
  private prevContainerBg = "";
  private prevRowBg: string[] = [];

  private _scrollbackRowEls: HTMLDivElement[] = [];
  private _renderedScrollbackCount = 0;

  private linkify: NormalizedLinkify;

  constructor(container: HTMLElement, options: { linkify?: NormalizedLinkify } = {}) {
    this.container = container;
    this.linkify = options.linkify ?? {
      enabled: false,
      pattern: DEFAULT_URL_PATTERN,
      onClick: null,
    };
  }

  setup(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.container.innerHTML = "";
    this.rowEls = [];
    this.prevRowBg = [];
    this._scrollbackRowEls = [];
    this._renderedScrollbackCount = 0;

    const fragment = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "term-row";
      fragment.appendChild(rowEl);
      this.rowEls.push(rowEl);
    }
    this.container.appendChild(fragment);
    this.prevCursorRow = -1;
    this.prevCursorCol = -1;
  }

  private _buildRowContent(
    rowEl: HTMLDivElement,
    getCell: (col: number) => CellData,
    lineLen: number,
    cursorCol: number,
    rowIndex: number,
  ): void {
    rowEl.textContent = "";

    // Pre-pass 1: collect the plain text of the row so the linkify regex can
    // run against it. One character per column so that URL ranges returned
    // by findUrls line up 1:1 with grid columns. Block glyphs and non-
    // printables become a space — a URL-breaking character that also
    // preserves col→rowText alignment.
    let rowText = "";
    for (let col = 0; col < this.cols; col++) {
      const cell = getCell(col);
      const inBounds = col < lineLen;
      const cp = inBounds ? cell.char : 0;
      const isBlock = inBounds && cp >= 0x2580 && cp <= 0x259f;
      if (isBlock || !inBounds || cp < 32) {
        rowText += " ";
      } else {
        rowText += String.fromCodePoint(cp);
      }
    }

    // Pre-pass 2: find URL ranges (empty when linkify disabled).
    const urlRanges = this.linkify.enabled ? findUrls(rowText, this.linkify.pattern) : [];

    function urlIdxAt(col: number): number {
      for (let i = 0; i < urlRanges.length; i++) {
        const r = urlRanges[i];
        if (col >= r.start && col < r.end) return i;
      }
      return -1;
    }

    // Render state.
    let runStyle = "";
    let runText = "";
    let runStart = 0;
    let runUrlIdx = -1;

    // If the current run is inside a URL, `currentAnchor` is the open <a>
    // that should receive the span(s). When we leave the URL or change to a
    // different URL, we close (null out) the anchor.
    let currentAnchor: HTMLAnchorElement | null = null;

    const openAnchor = (urlIdx: number): HTMLAnchorElement => {
      const a = document.createElement("a");
      a.className = "term-link";
      a.href = urlRanges[urlIdx].url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      rowEl.appendChild(a);
      return a;
    };

    const appendInto = (parent: HTMLElement, text: string, style: string): void => {
      const span = document.createElement("span");
      if (style) span.style.cssText = style;
      span.textContent = text;
      parent.appendChild(span);
    };

    const flushRun = (endCol: number): void => {
      if (!runText) return;
      const target: HTMLElement =
        runUrlIdx !== -1
          ? (currentAnchor ?? (currentAnchor = openAnchor(runUrlIdx)))
          : rowEl;

      if (cursorCol >= runStart && cursorCol < endCol) {
        const offset = cursorCol - runStart;
        const before = runText.slice(0, offset);
        const cursorChar = runText[offset];
        const after = runText.slice(offset + 1);
        if (before) appendInto(target, before, runStyle);
        const cursorSpan = document.createElement("span");
        cursorSpan.className = "term-cursor";
        if (runStyle) cursorSpan.style.cssText = runStyle;
        cursorSpan.textContent = cursorChar;
        target.appendChild(cursorSpan);
        if (after) appendInto(target, after, runStyle);
      } else {
        appendInto(target, runText, runStyle);
      }
    };

    for (let col = 0; col < this.cols; col++) {
      const cell = getCell(col);
      const inBounds = col < lineLen;
      const cp = inBounds ? cell.char : 0;

      if (inBounds && cp >= 0x2580 && cp <= 0x259f) {
        // Block glyph — always flushes the current run (same as before), and
        // block glyphs are never inside anchors (pre-pass 1 filtered them).
        flushRun(col);
        if (currentAnchor) currentAnchor = null;
        const colors = resolveColors(cell.fg, cell.bg, cell.flags);
        const span = document.createElement("span");
        span.className = col === cursorCol ? "term-block term-cursor" : "term-block";
        span.style.background = getBlockBackground(cp, colors.fg, colors.bg);
        if (cell.flags & FLAG_DIM) span.style.opacity = "0.5";
        rowEl.appendChild(span);
        runStyle = "";
        runText = "";
        runStart = col + 1;
        runUrlIdx = -1;
      } else {
        const ch = inBounds && cp >= 32 ? String.fromCodePoint(cp) : " ";
        const style = inBounds ? buildCellStyle(cell.fg, cell.bg, cell.flags) : "";
        const urlIdx = urlIdxAt(col);

        if (style !== runStyle || urlIdx !== runUrlIdx) {
          flushRun(col);
          if (urlIdx !== runUrlIdx) {
            // Leaving old URL scope (if any) — close the anchor so the next
            // URL-internal run opens a fresh one.
            currentAnchor = null;
          }
          runStyle = style;
          runText = ch;
          runStart = col;
          runUrlIdx = urlIdx;
        } else {
          runText += ch;
        }
      }
    }
    flushRun(this.cols);

    // Extend the row background when the line fills the full width.
    let bgCss = "";
    if (lineLen >= this.cols && this.cols > 0) {
      const lastCell = getCell(this.cols - 1);
      let bgC = lastCell.bg;
      if (lastCell.flags & FLAG_REVERSE) {
        bgC = lastCell.fg;
        if (bgC === DEFAULT_COLOR) bgC = 7;
      }
      bgCss = colorToCSS(bgC) || "";
    }
    const boxShadow = bgCss ? `0 1px 0 ${bgCss}` : "";
    if (rowIndex >= 0) {
      if (bgCss !== (this.prevRowBg[rowIndex] ?? "")) {
        rowEl.style.background = bgCss;
        rowEl.style.boxShadow = boxShadow;
        this.prevRowBg[rowIndex] = bgCss;
      }
    } else {
      rowEl.style.background = bgCss;
      rowEl.style.boxShadow = boxShadow;
    }
  }

  private _buildScrollbackRowEl(
    bridge: WasmBridge,
    sbOffset: number,
  ): HTMLDivElement {
    const rowEl = document.createElement("div");
    rowEl.className = "term-row term-scrollback-row";
    const lineLen = bridge.getScrollbackLineLen(sbOffset);

    this._buildRowContent(
      rowEl,
      (col) => bridge.getScrollbackCell(sbOffset, col),
      lineLen,
      -1,
      -1,
    );
    return rowEl;
  }

  private syncScrollback(bridge: WasmBridge): void {
    const scrollbackCount = bridge.getScrollbackCount();

    if (scrollbackCount === this._renderedScrollbackCount) return;

    if (scrollbackCount > this._renderedScrollbackCount) {
      const newCount = scrollbackCount - this._renderedScrollbackCount;
      const firstGridRow = this.rowEls[0] ?? null;
      const fragment = document.createDocumentFragment();

      for (let i = newCount - 1; i >= 0; i--) {
        const rowEl = this._buildScrollbackRowEl(bridge, i);
        fragment.appendChild(rowEl);
        this._scrollbackRowEls.push(rowEl);
      }

      this.container.insertBefore(fragment, firstGridRow);
    } else {
      const removeCount = this._renderedScrollbackCount - scrollbackCount;
      for (let i = 0; i < removeCount; i++) {
        const el = this._scrollbackRowEls.shift();
        if (el) el.remove();
      }
    }

    this._renderedScrollbackCount = scrollbackCount;
  }

  render(bridge: WasmBridge): void {
    const rows = bridge.getRows();
    const cols = bridge.getCols();

    let resized = false;
    if (rows !== this.rows || cols !== this.cols) {
      this.setup(cols, rows);
      resized = true;
    }

    this.syncScrollback(bridge);

    const cursor = bridge.getCursor();
    const cursorVisible = cursor.visible;

    const needsCursorUpdate =
      cursor.row !== this.prevCursorRow || cursor.col !== this.prevCursorCol;

    for (let r = 0; r < this.rows; r++) {
      const isDirty = resized || bridge.isDirtyRow(r);
      const hadCursor = r === this.prevCursorRow && needsCursorUpdate;
      const hasCursor = r === cursor.row;

      if (isDirty || hadCursor || (hasCursor && needsCursorUpdate)) {
        const cCol = hasCursor && cursorVisible ? cursor.col : -1;
        this._buildRowContent(
          this.rowEls[r],
          (col) => bridge.getCell(r, col),
          this.cols,
          cCol,
          r,
        );
      }
    }

    this.prevCursorRow = cursor.row;
    this.prevCursorCol = cursor.col;

    // Update the container background only when the last row was actually
    // repainted, avoiding stale reads during partial mid-redraw frames.
    const lastRowDirty = resized || bridge.isDirtyRow(this.rows - 1);
    if (lastRowDirty) {
      const bottomRight = bridge.getCell(this.rows - 1, this.cols - 1);
      let gridBg = bottomRight.bg;
      if (bottomRight.flags & FLAG_REVERSE) {
        gridBg = bottomRight.fg;
        if (gridBg === DEFAULT_COLOR) gridBg = 7;
      }
      const containerBg = colorToCSS(gridBg) || "";
      if (containerBg !== this.prevContainerBg) {
        this.container.style.background = containerBg;
        this.prevContainerBg = containerBg;
      }
    }

    bridge.clearDirty();
  }
}
