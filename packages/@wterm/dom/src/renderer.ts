import type { CellData, TerminalCore } from "@wterm/core";

const DEFAULT_COLOR = 256;
const FLAG_BOLD = 0x01;
const FLAG_DIM = 0x02;
const FLAG_ITALIC = 0x04;
const FLAG_UNDERLINE = 0x08;
const FLAG_REVERSE = 0x20;
const FLAG_INVISIBLE = 0x40;
const FLAG_STRIKETHROUGH = 0x80;
const DEFAULT_SCROLLBACK_OVERSCAN_ROWS = 10;

export interface RenderViewport {
  scrollTop: number;
  clientHeight: number;
  rowHeight: number;
  overscanRows?: number;
  scrollbackDiscardedCount?: number;
}

function rgbToCSS(packed: number): string {
  const r = (packed >> 16) & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = packed & 0xff;
  return `rgb(${r},${g},${b})`;
}

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

function cellFgCSS(fg: number, fgRgb: number | undefined): string | null {
  if (fgRgb !== undefined) return rgbToCSS(fgRgb);
  return colorToCSS(fg);
}

function cellBgCSS(bg: number, bgRgb: number | undefined): string | null {
  if (bgRgb !== undefined) return rgbToCSS(bgRgb);
  return colorToCSS(bg);
}

function buildCellStyle(
  fg: number,
  bg: number,
  flags: number,
  fgRgb?: number,
  bgRgb?: number,
): string {
  let fgIdx = fg,
    bgIdx = bg,
    fgR = fgRgb,
    bgR = bgRgb;

  if (flags & FLAG_REVERSE) {
    const tmpIdx = fgIdx;
    fgIdx = bgIdx;
    bgIdx = tmpIdx;
    const tmpR = fgR;
    fgR = bgR;
    bgR = tmpR;
    if (fgR === undefined && fgIdx === DEFAULT_COLOR) fgIdx = 0;
    if (bgR === undefined && bgIdx === DEFAULT_COLOR) bgIdx = 7;
  }

  const fgCSS = cellFgCSS(fgIdx, fgR);
  const bgCSS = cellBgCSS(bgIdx, bgR);

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

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeLinkHref(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function linkIdentity(cell: CellData): string {
  if (!cell.linkUri) return "";
  return cell.linkKey ?? `fallback\0${cell.linkId ?? ""}\0${cell.linkUri}`;
}

function resolveColors(
  fg: number,
  bg: number,
  flags: number,
  fgRgb?: number,
  bgRgb?: number,
): { fg: string; bg: string } {
  let fgIdx = fg,
    bgIdx = bg,
    fgR = fgRgb,
    bgR = bgRgb;

  if (flags & FLAG_REVERSE) {
    [fgIdx, bgIdx] = [bgIdx, fgIdx];
    [fgR, bgR] = [bgR, fgR];
    if (fgR === undefined && fgIdx === DEFAULT_COLOR) fgIdx = 0;
    if (bgR === undefined && bgIdx === DEFAULT_COLOR) bgIdx = 7;
  }
  return {
    fg: cellFgCSS(fgIdx, fgR) || "var(--term-fg)",
    bg: cellBgCSS(bgIdx, bgR) || "var(--term-bg)",
  };
}

// Pixel-snapped vertical gradient stops keyed off `--term-row-height` so that
// every cell paints the eighth-block boundary on the same physical pixel —
// using raw percentages (e.g. `12.5%`) at the canonical 17px row-height
// resolves to 2.125px and the browser rounds it differently across cells,
// producing the per-cell jog Claude Code's horizontal-rule (`▔▔▔▔▔`) makes
// visible against the row immediately below.
const SNAP_1_8 = "round(calc(var(--term-row-height) * 0.125), 1px)";
const SNAP_2_8 = "round(calc(var(--term-row-height) * 0.25), 1px)";
const SNAP_3_8 = "round(calc(var(--term-row-height) * 0.375), 1px)";
const SNAP_4_8 = "round(calc(var(--term-row-height) * 0.5), 1px)";
const SNAP_5_8 = "round(calc(var(--term-row-height) * 0.625), 1px)";
const SNAP_6_8 = "round(calc(var(--term-row-height) * 0.75), 1px)";
const SNAP_7_8 = "round(calc(var(--term-row-height) * 0.875), 1px)";

function getBlockBackground(cp: number, fg: string, bg: string): string {
  switch (cp) {
    case 0x2580:
      return `linear-gradient(${fg} ${SNAP_4_8},${bg} ${SNAP_4_8})`;
    case 0x2581:
      return `linear-gradient(${bg} ${SNAP_7_8},${fg} ${SNAP_7_8})`;
    case 0x2582:
      return `linear-gradient(${bg} ${SNAP_6_8},${fg} ${SNAP_6_8})`;
    case 0x2583:
      return `linear-gradient(${bg} ${SNAP_5_8},${fg} ${SNAP_5_8})`;
    case 0x2584:
      return `linear-gradient(${bg} ${SNAP_4_8},${fg} ${SNAP_4_8})`;
    case 0x2585:
      return `linear-gradient(${bg} ${SNAP_3_8},${fg} ${SNAP_3_8})`;
    case 0x2586:
      return `linear-gradient(${bg} ${SNAP_2_8},${fg} ${SNAP_2_8})`;
    case 0x2587:
      return `linear-gradient(${bg} ${SNAP_1_8},${fg} ${SNAP_1_8})`;
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
      return `linear-gradient(${fg} ${SNAP_1_8},${bg} ${SNAP_1_8})`;
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
  private _scrollbackStartKey = 0;
  private _renderedScrollbackCount = -1;
  private _renderedDiscardedCount = -1;
  private _scrollbackTopSpacer: HTMLDivElement | null = null;
  private _scrollbackBottomSpacer: HTMLDivElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setup(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.container.innerHTML = "";
    this.rowEls = [];
    this.prevRowBg = [];
    this._scrollbackRowEls = [];
    this._scrollbackStartKey = 0;
    this._renderedScrollbackCount = -1;
    this._renderedDiscardedCount = -1;

    const fragment = document.createDocumentFragment();
    this._scrollbackTopSpacer = document.createElement("div");
    this._scrollbackTopSpacer.className = "term-scrollback-spacer";
    fragment.appendChild(this._scrollbackTopSpacer);

    this._scrollbackBottomSpacer = document.createElement("div");
    this._scrollbackBottomSpacer.className = "term-scrollback-spacer";
    fragment.appendChild(this._scrollbackBottomSpacer);

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
    let html = "";
    let runStyle = "";
    let runText = "";
    let runCells: string[] = [];
    let runStart = 0;
    let runLinkKey = "";
    let runLinkUri: string | undefined;
    let outputLinkKey = "";

    const appendContent = (
      content: string,
      linkKey: string,
      uri: string | undefined,
    ) => {
      const href = safeLinkHref(uri);
      const nextLinkKey = href ? linkKey : "";
      if (nextLinkKey !== outputLinkKey) {
        if (outputLinkKey) html += "</a>";
        if (nextLinkKey) {
          html += `<a class="term-link" href="${escapeHTML(href!)}" target="_blank" rel="noopener noreferrer">`;
        }
        outputLinkKey = nextLinkKey;
      }
      html += content;
    };

    const flushRun = (endCol: number) => {
      if (!runText) return;
      const escaped = escapeHTML(runText);
      let content = "";

      if (cursorCol >= runStart && cursorCol < endCol) {
        const offset = cursorCol - runStart;
        const before = runCells.slice(0, offset).join("");
        const cursorChar = runCells[offset] || " ";
        const after = runCells.slice(offset + 1).join("");

        if (before) {
          content += runStyle
            ? `<span style="${runStyle}">${escapeHTML(before)}</span>`
            : `<span>${escapeHTML(before)}</span>`;
        }
        content += runStyle
          ? `<span class="term-cursor" style="${runStyle}">${escapeHTML(cursorChar)}</span>`
          : `<span class="term-cursor">${escapeHTML(cursorChar)}</span>`;
        if (after) {
          content += runStyle
            ? `<span style="${runStyle}">${escapeHTML(after)}</span>`
            : `<span>${escapeHTML(after)}</span>`;
        }
      } else {
        content += runStyle
          ? `<span style="${runStyle}">${escaped}</span>`
          : `<span>${escaped}</span>`;
      }
      appendContent(content, runLinkKey, runLinkUri);
      runText = "";
      runCells = [];
    };

    const appendStyledSpan = (
      className: string,
      style: string,
      text: string,
      linkKey: string,
      linkUri?: string,
    ) => {
      const classAttr = className ? ` class="${className}"` : "";
      const styleAttr = style ? ` style="${style}"` : "";
      appendContent(
        `<span${classAttr}${styleAttr}>${escapeHTML(text)}</span>`,
        linkKey,
        linkUri,
      );
    };

    for (let col = 0; col < this.cols; col++) {
      const cell = getCell(col);
      const inBounds = col < lineLen;
      const cp = inBounds ? cell.char : 0;
      const width = inBounds ? (cell.width ?? 1) : 1;
      const cellLinkKey = inBounds ? linkIdentity(cell) : "";
      const cellLinkUri = inBounds ? cell.linkUri : undefined;

      if (inBounds && width === 0) {
        flushRun(col);
        // Skipping is only right when this continues the wide cell to the
        // left, which already covers both columns and its cursor. A width-0
        // cell with no wide cell before it owns its column, so dropping it
        // would shorten the row.
        const continuesWide = col > 0 && (getCell(col - 1).width ?? 1) === 2;
        if (!continuesWide) {
          appendStyledSpan(
            col === cursorCol ? "term-cursor" : "",
            "",
            " ",
            cellLinkKey,
            cellLinkUri,
          );
        }
        runStyle = "";
        runLinkKey = "";
        runLinkUri = undefined;
        runText = "";
        runCells = [];
        runStart = col + 1;
        continue;
      }

      if (inBounds && width === 2) {
        flushRun(col);

        // A scrollback row keeps the width it was stored at, so a narrower
        // grid can put the last rendered column on a wide lead whose
        // continuation is outside the row. Drawing the pair here would spill
        // a second column past the row.
        if (col + 1 >= this.cols) {
          appendStyledSpan(
            col === cursorCol ? "term-cursor" : "",
            "",
            " ",
            cellLinkKey,
            cellLinkUri,
          );
          runStyle = "";
          runLinkKey = "";
          runLinkUri = undefined;
          runText = "";
          runCells = [];
          runStart = col + 1;
          continue;
        }

        const ch = cell.chars ?? (cp >= 32 ? String.fromCodePoint(cp) : " ");
        const style = buildCellStyle(
          cell.fg,
          cell.bg,
          cell.flags,
          cell.fgRgb,
          cell.bgRgb,
        );
        const cls =
          cursorCol >= col && cursorCol < col + 2
            ? "term-wide term-cursor"
            : "term-wide";
        appendStyledSpan(cls, style, ch, cellLinkKey, cellLinkUri);

        runStyle = "";
        runLinkKey = "";
        runLinkUri = undefined;
        runText = "";
        runCells = [];
        runStart = col + 2;
        continue;
      }

      if (inBounds && cp >= 0x2580 && cp <= 0x259f) {
        flushRun(col);

        const colors = resolveColors(
          cell.fg,
          cell.bg,
          cell.flags,
          cell.fgRgb,
          cell.bgRgb,
        );
        const cls = col === cursorCol ? "term-block term-cursor" : "term-block";
        const bg = getBlockBackground(cp, colors.fg, colors.bg);
        const dim = cell.flags & FLAG_DIM ? "opacity:0.5;" : "";
        appendContent(
          `<span class="${cls}" style="background:${bg};${dim}"></span>`,
          cellLinkKey,
          cellLinkUri,
        );

        runStyle = "";
        runLinkKey = "";
        runLinkUri = undefined;
        runText = "";
        runCells = [];
        runStart = col + 1;
      } else {
        const ch =
          cell.chars ?? (inBounds && cp >= 32 ? String.fromCodePoint(cp) : " ");
        const style = inBounds
          ? buildCellStyle(cell.fg, cell.bg, cell.flags, cell.fgRgb, cell.bgRgb)
          : "";

        if (style !== runStyle || cellLinkKey !== runLinkKey) {
          flushRun(col);
          runStyle = style;
          runLinkKey = cellLinkKey;
          runLinkUri = cellLinkUri;
          runText = ch;
          runCells = [ch];
          runStart = col;
        } else {
          runText += ch;
          runCells.push(ch);
        }
      }
    }
    flushRun(this.cols);
    if (outputLinkKey) html += "</a>";

    rowEl.innerHTML = html;

    let bgCss = "";
    if (lineLen >= this.cols && this.cols > 0) {
      const lastCell = getCell(this.cols - 1);
      let bgIdx = lastCell.bg;
      let bgR = lastCell.bgRgb;
      if (lastCell.flags & FLAG_REVERSE) {
        bgIdx = lastCell.fg;
        bgR = lastCell.fgRgb;
        if (bgR === undefined && bgIdx === DEFAULT_COLOR) bgIdx = 7;
      }
      bgCss = cellBgCSS(bgIdx, bgR) || "";
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
    core: TerminalCore,
    sbOffset: number,
  ): HTMLDivElement {
    const rowEl = document.createElement("div");
    rowEl.className = "term-row term-scrollback-row";
    const lineLen = core.getScrollbackLineLen(sbOffset);

    this._buildRowContent(
      rowEl,
      (col) => core.getScrollbackCell(sbOffset, col),
      lineLen,
      -1,
      -1,
    );
    return rowEl;
  }

  private syncScrollback(core: TerminalCore, viewport?: RenderViewport): void {
    const scrollbackCount = core.getScrollbackCount();
    const rowHeight = viewport?.rowHeight ?? 0;
    const virtual = viewport !== undefined && rowHeight > 0;
    const overscan = viewport?.overscanRows ?? DEFAULT_SCROLLBACK_OVERSCAN_ROWS;
    const hasDiscardedCount = viewport?.scrollbackDiscardedCount !== undefined;
    const discardedCount = viewport?.scrollbackDiscardedCount ?? 0;
    const viewportHeight =
      viewport && viewport.clientHeight > 0
        ? viewport.clientHeight
        : this.rows * rowHeight;
    const firstVisible = virtual
      ? Math.floor(viewport.scrollTop / rowHeight)
      : 0;
    const visibleRows = virtual
      ? Math.ceil(viewportHeight / rowHeight)
      : scrollbackCount;
    let start = virtual
      ? Math.max(0, Math.min(scrollbackCount, firstVisible - overscan))
      : 0;
    let end = virtual
      ? Math.max(
          start,
          Math.min(scrollbackCount, firstVisible + visibleRows + overscan),
        )
      : scrollbackCount;
    const selection = this.container.ownerDocument.getSelection();
    const selectionInContainer =
      selection !== null &&
      !selection.isCollapsed &&
      (this.container.contains(selection.anchorNode) ||
        this.container.contains(selection.focusNode));
    if (selectionInContainer && this._scrollbackRowEls.length > 0) {
      start = Math.min(
        start,
        Math.max(0, this._scrollbackStartKey - discardedCount),
      );
      end = Math.max(
        end,
        Math.min(
          scrollbackCount,
          this._scrollbackStartKey -
            discardedCount +
            this._scrollbackRowEls.length,
        ),
      );
    }

    const startKey = discardedCount + start;
    if (
      hasDiscardedCount &&
      scrollbackCount === this._renderedScrollbackCount &&
      discardedCount === this._renderedDiscardedCount &&
      startKey === this._scrollbackStartKey &&
      end - start === this._scrollbackRowEls.length
    ) {
      return;
    }

    const previous = new Map<number, HTMLDivElement>();
    for (let i = 0; i < this._scrollbackRowEls.length; i++) {
      previous.set(this._scrollbackStartKey + i, this._scrollbackRowEls[i]);
    }

    const endKey = discardedCount + end;
    for (const [key, rowEl] of previous) {
      if (key < startKey || key >= endKey) rowEl.remove();
    }

    const nextRows: HTMLDivElement[] = [];
    let nextSibling = this._scrollbackTopSpacer?.nextSibling ?? null;
    for (let index = start; index < end; index++) {
      const key = discardedCount + index;
      const offset = scrollbackCount - 1 - index;
      const candidate = this._buildScrollbackRowEl(core, offset);
      const existing = previous.get(key);
      let rowEl = candidate;
      let positioned = false;

      if (
        existing &&
        existing.innerHTML === candidate.innerHTML &&
        existing.style.cssText === candidate.style.cssText
      ) {
        rowEl = existing;
      } else if (existing) {
        existing.replaceWith(candidate);
        positioned = true;
      }

      if (!positioned && rowEl !== nextSibling) {
        this.container.insertBefore(
          rowEl,
          nextSibling ?? this._scrollbackBottomSpacer,
        );
      }
      nextSibling = rowEl.nextSibling;
      nextRows.push(rowEl);
    }
    this._scrollbackRowEls = nextRows;
    this._scrollbackStartKey = startKey;
    this._renderedScrollbackCount = scrollbackCount;
    this._renderedDiscardedCount = discardedCount;

    if (this._scrollbackTopSpacer) {
      this._scrollbackTopSpacer.style.height = `${start * rowHeight}px`;
    }
    if (this._scrollbackBottomSpacer) {
      this._scrollbackBottomSpacer.style.height = `${(scrollbackCount - end) * rowHeight}px`;
    }
  }

  render(core: TerminalCore, viewport?: RenderViewport): void {
    const rows = core.getRows();
    const cols = core.getCols();

    let resized = false;
    if (rows !== this.rows || cols !== this.cols) {
      this.setup(cols, rows);
      resized = true;
    }

    this.syncScrollback(core, viewport);

    const cursor = core.getCursor();
    const cursorVisible = cursor.visible;

    const needsCursorUpdate =
      cursor.row !== this.prevCursorRow || cursor.col !== this.prevCursorCol;

    for (let r = 0; r < this.rows; r++) {
      const isDirty = resized || core.isDirtyRow(r);
      const hadCursor = r === this.prevCursorRow && needsCursorUpdate;
      const hasCursor = r === cursor.row;

      if (isDirty || hadCursor || (hasCursor && needsCursorUpdate)) {
        const cCol = hasCursor && cursorVisible ? cursor.col : -1;
        this._buildRowContent(
          this.rowEls[r],
          (col) => core.getCell(r, col),
          this.cols,
          cCol,
          r,
        );
      }
    }

    this.prevCursorRow = cursor.row;
    this.prevCursorCol = cursor.col;

    const lastRowDirty = resized || core.isDirtyRow(this.rows - 1);
    if (lastRowDirty) {
      const bottomRight = core.getCell(this.rows - 1, this.cols - 1);
      let gridBgIdx = bottomRight.bg;
      let gridBgRgb = bottomRight.bgRgb;
      if (bottomRight.flags & FLAG_REVERSE) {
        gridBgIdx = bottomRight.fg;
        gridBgRgb = bottomRight.fgRgb;
        if (gridBgRgb === undefined && gridBgIdx === DEFAULT_COLOR)
          gridBgIdx = 7;
      }
      const containerBg = cellBgCSS(gridBgIdx, gridBgRgb) || "";
      if (containerBg !== this.prevContainerBg) {
        this.container.style.background = containerBg;
        this.prevContainerBg = containerBg;
      }
    }

    core.clearDirty();
  }
}
