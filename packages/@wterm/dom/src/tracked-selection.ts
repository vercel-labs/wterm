import type {
  TerminalCore,
  TerminalPosition,
  TrackedTerminalPosition,
} from "@wterm/core";
import {
  cellAtOffset,
  offsetAtCell,
  readSelection,
  textPoint,
  type SelectedRow,
} from "./selection.js";
import { MAX_SELECTION_ROWS, MAX_SELECTION_TEXT } from "./selection-range.js";

// Retain only the selected rows, separately from the viewport. Reflow must not
// turn a small native selection into an unbounded mounted history window.
export const MAX_TRACKED_SELECTION_ROWS = MAX_SELECTION_ROWS;
type Edge = { pin: TrackedTerminalPosition; after: boolean };
type NativeSelection = {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
};

export class TrackedSelection {
  private current: {
    start: Edge;
    end: Edge;
    text: string;
    backward: boolean;
    native: NativeSelection;
  } | null = null;
  private painted = true;

  constructor(private terminal: HTMLElement) {}

  private matches(): boolean {
    const selection = this.terminal.ownerDocument.getSelection();
    const native = this.current?.native;
    return (
      !!selection &&
      !!native &&
      selection.anchorNode === native.anchorNode &&
      selection.anchorOffset === native.anchorOffset &&
      selection.focusNode === native.focusNode &&
      selection.focusOffset === native.focusOffset
    );
  }

  capture(core: TerminalCore, rows: Iterable<SelectedRow>): void {
    const active = this.terminal.ownerDocument.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
    ) {
      const input = active as HTMLInputElement | HTMLTextAreaElement;
      if (input.selectionStart !== input.selectionEnd) {
        this.dispose();
        return;
      }
    }
    if (this.current && this.matches()) return;
    this.dispose();
    // The browser can select an older synchronized frame. Never pin those
    // coordinates into the newer core state.
    if (!this.painted || !core.trackPosition) return;
    const value = readSelection(this.terminal, rows);
    if (
      !value ||
      !value.text.length ||
      value.last.row.row - value.first.row.row >= MAX_TRACKED_SELECTION_ROWS ||
      value.text.length > MAX_SELECTION_TEXT
    )
      return;
    const start = cellAtOffset(
      value.first.row.content,
      value.first.offset,
      false,
    );
    const end = cellAtOffset(value.last.row.content, value.last.offset, true);
    const a = core.trackPosition({ row: value.first.row.row, col: start.col });
    if (!a) return;
    const b = core.trackPosition({ row: value.last.row.row, col: end.col });
    if (!b) {
      a.dispose();
      return;
    }
    const selection = this.terminal.ownerDocument.getSelection()!;
    this.current = {
      start: { pin: a, after: start.after },
      end: { pin: b, after: end.after },
      text: value.text,
      backward: value.backward,
      native: this.snapshot(selection),
    };
  }

  beforeMutation(core: TerminalCore, rows: Iterable<SelectedRow>): void {
    this.capture(core, rows);
    this.painted = false;
  }

  beforeRender(
    core: TerminalCore,
    rows: Iterable<SelectedRow>,
  ): { start: TerminalPosition; end: TerminalPosition } | null {
    this.capture(core, rows);
    const start = this.current?.start.pin.resolve();
    const end = this.current?.end.pin.resolve();
    if (
      !start ||
      !end ||
      end.row < start.row ||
      (end.row === start.row && end.col < start.col) ||
      end.row - start.row >= MAX_TRACKED_SELECTION_ROWS
    ) {
      this.clear();
      return null;
    }
    return { start, end };
  }

  afterRender(
    rows: Iterable<SelectedRow>,
    positions: { start: TerminalPosition; end: TerminalPosition } | null,
  ): void {
    this.painted = true;
    const current = this.current;
    if (!current || !positions) return;
    const mounted = Array.from(rows);
    const edge = (position: TerminalPosition, after: boolean) => {
      const row = mounted.find((row) => row.row === position.row);
      return (
        row &&
        textPoint(row.element, offsetAtCell(row.content, position.col, after))
      );
    };
    const start = edge(positions.start, current.start.after);
    const end = edge(positions.end, current.end.after);
    const selection = this.terminal.ownerDocument.getSelection();
    if (!start || !end || !selection) {
      this.clear();
      return;
    }
    const anchor = current.backward ? end : start;
    const focus = current.backward ? start : end;
    if (
      selection.anchorNode !== anchor[0] ||
      selection.anchorOffset !== anchor[1] ||
      selection.focusNode !== focus[0] ||
      selection.focusOffset !== focus[1]
    ) {
      selection.setBaseAndExtent(...anchor, ...focus);
    }
    current.native = this.snapshot(selection);
    // Pins track locations, not immutable text. Erases/overwrites must not
    // quietly change what a pending Copy would send to another application.
    if (readSelection(this.terminal, mounted)?.text !== current.text)
      this.clear();
  }

  private snapshot(selection: Selection): NativeSelection {
    return {
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
    };
  }

  private clear(): void {
    if (this.current && this.matches())
      this.terminal.ownerDocument.getSelection()?.removeAllRanges();
    this.dispose();
  }

  dispose(): void {
    this.current?.start.pin.dispose();
    this.current?.end.pin.dispose();
    this.current = null;
  }
}
