import type { TerminalRowMetadata } from "@wterm/core";

/** Text offsets are UTF-16 offsets in a rendered row, not terminal columns. */
export interface RenderedRowText {
  text: string;
  specialCells: {
    start: number;
    end: number;
    col: number;
    width: number;
    omit: boolean;
  }[];
  metadata: TerminalRowMetadata | null;
}

export interface SelectedRow {
  row: number;
  element: HTMLElement;
  content: RenderedRowText;
}

/** Expand partial graphemes and remove layout-only wide-glyph spacer heads. */
function selectedText(
  content: RenderedRowText,
  start: number,
  end: number,
): string {
  const parts: string[] = [];
  let cursor = start;
  for (const cell of content.specialCells) {
    if (cell.end <= start) continue;
    if (cell.start >= end) break;
    if (cursor < cell.start) parts.push(content.text.slice(cursor, cell.start));
    if (!cell.omit) parts.push(content.text.slice(cell.start, cell.end));
    cursor = cell.end;
  }
  if (cursor < end) parts.push(content.text.slice(cursor, end));
  return parts.join("");
}

/**
 * Extract only a selection wholly owned by this terminal. Work against the
 * painted snapshot: core state can already be ahead of the visible frame.
 * Unknown/missing rows, multiple ranges, and selections outside the terminal
 * stay with the browser rather than silently exporting incomplete history.
 */
export function getSelectionText(
  terminal: HTMLElement,
  rows: Iterable<SelectedRow>,
): string | null {
  return readSelection(terminal, rows)?.text ?? null;
}

export function readSelection(
  terminal: HTMLElement,
  rows: Iterable<SelectedRow>,
) {
  const selection = terminal.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
    return null;
  const range = selection.getRangeAt(0);
  if (
    !terminal.contains(range.startContainer) ||
    !terminal.contains(range.endContainer)
  )
    return null;
  const active = terminal.ownerDocument.activeElement;
  // Input controls have a separate selection that need not clear DOM ranges.
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
    const input = active as HTMLInputElement | HTMLTextAreaElement;
    if (input.selectionStart !== input.selectionEnd) return null;
  }

  const parts: string[] = [];
  let first: { row: SelectedRow; offset: number } | undefined;
  let last: { row: SelectedRow; offset: number } | undefined;
  let previous: SelectedRow | undefined;
  for (const current of rows) {
    const { element, content } = current;
    if (!range.intersectsNode(element)) continue;
    const selected = terminal.ownerDocument.createRange();
    selected.selectNodeContents(element);
    if (element.contains(range.startContainer))
      selected.setStart(range.startContainer, range.startOffset);
    if (element.contains(range.endContainer))
      selected.setEnd(range.endContainer, range.endOffset);
    const before = terminal.ownerDocument.createRange();
    before.selectNodeContents(element);
    before.setEnd(selected.startContainer, selected.startOffset);
    const start = before.toString().length;
    const end = start + selected.toString().length;
    // A host modifying terminal-owned text makes the saved offsets invalid.
    if (element.textContent !== content.text) return null;
    first ??= { row: current, offset: start };
    last = {
      row: current,
      offset:
        end === content.text.length && !content.metadata?.wrapsToNext
          ? Math.max(start, content.text.replace(/ +$/, "").length)
          : end,
    };
    if (previous) {
      if (current.row !== previous.row + 1) return null;
      const wrapped =
        previous.content.metadata?.wrapsToNext &&
        content.metadata?.continuesPrevious;
      if (!wrapped) parts.push("\n");
    }
    let text = start === end ? "" : selectedText(content, start, end);
    if (end === content.text.length && !content.metadata?.wrapsToNext)
      text = text.replace(/ +$/, "");
    parts.push(text);
    previous = current;
  }
  return first && last
    ? {
        text: parts.join(""),
        first,
        last,
        backward:
          selection.anchorNode !== range.startContainer ||
          selection.anchorOffset !== range.startOffset,
      }
    : null;
}

/** Anchor an edge to an included cell, so an end at a wrap follows that cell. */
export function cellAtOffset(
  content: RenderedRowText,
  offset: number,
  end: boolean,
) {
  let delta = 0;
  for (const cell of content.specialCells) {
    if (
      (offset >= cell.start && offset < cell.end && !end) ||
      (offset > cell.start && offset <= cell.end && end)
    ) {
      return { col: cell.col, after: end };
    }
    if (cell.end <= offset) delta += cell.width - (cell.end - cell.start);
  }
  const after = offset > 0 && (end || offset === content.text.length);
  return { col: offset + delta - (after ? 1 : 0), after };
}

export function offsetAtCell(
  content: RenderedRowText,
  col: number,
  after: boolean,
): number {
  let delta = 0;
  for (const cell of content.specialCells) {
    if (col >= cell.col && col < cell.col + cell.width)
      return after ? cell.end : cell.start;
    if (cell.col < col) delta += cell.end - cell.start - cell.width;
  }
  return col + delta + (after ? 1 : 0);
}

export function textPoint(
  element: HTMLElement,
  offset: number,
): [Node, number] | null {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    4 /* SHOW_TEXT */,
  );
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (offset <= length) return [node, offset];
    offset -= length;
  }
  return null;
}
