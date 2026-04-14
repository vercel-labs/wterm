import type { WasmBridge } from "@wterm/core";

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
  if (style) {
    const span = document.createElement("span");
    span.style.cssText = style;
    span.textContent = text;
    parent.appendChild(span);
  } else {
    parent.appendChild(document.createTextNode(text));
  }
}

export class Renderer {
  private container: HTMLElement;
  private rows = 0;
  private cols = 0;

  private rowEls: HTMLDivElement[] = [];
  private prevCursorRow = -1;
  private prevCursorCol = -1;

  private _scrollbackRowEls: HTMLDivElement[] = [];
  private _renderedScrollbackCount = 0;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setup(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.container.innerHTML = "";
    this.rowEls = [];
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
    getCell: (col: number) => {
      char: number;
      fg: number;
      bg: number;
      flags: number;
    },
    lineLen: number,
    cursorCol: number,
  ): void {
    rowEl.textContent = "";

    let runStyle = "";
    let runText = "";
    let runStart = 0;

    const flushRun = (endCol: number) => {
      if (!runText) return;

      if (cursorCol >= runStart && cursorCol < endCol) {
        const offset = cursorCol - runStart;
        const before = runText.slice(0, offset);
        const cursorChar = runText[offset];
        const after = runText.slice(offset + 1);

        if (before) appendRun(rowEl, before, runStyle);

        const cursorSpan = document.createElement("span");
        cursorSpan.className = "term-cursor";
        if (runStyle) cursorSpan.style.cssText = runStyle;
        cursorSpan.textContent = cursorChar;
        rowEl.appendChild(cursorSpan);

        if (after) appendRun(rowEl, after, runStyle);
      } else {
        appendRun(rowEl, runText, runStyle);
      }
    };

    for (let col = 0; col < this.cols; col++) {
      const cell = getCell(col);
      const inBounds = col < lineLen;
      const ch =
        inBounds && cell.char >= 32 ? String.fromCodePoint(cell.char) : " ";
      const style = inBounds
        ? buildCellStyle(cell.fg, cell.bg, cell.flags)
        : "";

      if (style !== runStyle) {
        flushRun(col);
        runStyle = style;
        runText = ch;
        runStart = col;
      } else {
        runText += ch;
      }
    }
    flushRun(this.cols);
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
        );
      }
    }

    this.prevCursorRow = cursor.row;
    this.prevCursorCol = cursor.col;

    bridge.clearDirty();
  }
}
