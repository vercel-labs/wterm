import type { TerminalCore } from "@wterm/core";

const MAX_SELECTION_TEXT = 16 * 1024 * 1024;
const owners = new WeakMap<Document, HistorySelection>();

/** Copy cell text in small batches without mounting retained history. */
export function* scanSelection(
  core: TerminalCore,
  limit = MAX_SELECTION_TEXT,
): Generator<void, string> {
  const history = core.getScrollbackCount();
  const parts: string[] = [];
  let chunk = "";
  let length = 0;
  let work = 0;
  let previousWrap = false;
  const append = (text: string) => {
    length += text.length;
    if (length > limit) throw new RangeError("Terminal selection is too large");
    chunk += text;
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  };
  for (let row = 0; row < history + core.getRows(); row++) {
    const offset = history - row - 1;
    const metadata =
      row < history
        ? core.getScrollbackRowMetadata?.(offset)
        : core.getRowMetadata?.(row - history);
    if (row > 0 && !(previousWrap && metadata?.continuesPrevious)) append("\n");
    previousWrap = metadata?.wrapsToNext ?? false;
    const cols =
      row < history ? core.getScrollbackLineLen(offset) : core.getCols();
    // Hold ASCII spaces until the row ends, so hard-line padding is omitted.
    let spaces = 0;
    for (let col = 0; col < cols; col++) {
      if (++work >= 256) {
        work = 0;
        yield;
      }
      const cell =
        row < history
          ? core.getScrollbackCell(offset, col)
          : core.getCell(row - history, col);
      if (cell.width === 0 || cell.spacerHead) continue;
      const text = cell.chars ?? String.fromCodePoint(cell.char || 32);
      if (/^ +$/.test(text)) {
        spaces += text.length;
      } else {
        if (length + spaces + text.length > limit)
          throw new RangeError("Terminal selection is too large");
        append(" ".repeat(spaces) + text);
        spaces = 0;
      }
    }
    if (previousWrap) {
      if (length + spaces > limit)
        throw new RangeError("Terminal selection is too large");
      append(" ".repeat(spaces));
    }
    if (++work >= 256) {
      work = 0;
      yield;
    }
  }
  parts.push(chunk);
  return parts.join("");
}

/** A complete, immutable selection; no partial text is exposed while scanning. */
export class HistorySelection {
  private text: string | null = null;
  private scan: Generator<void, string> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolve: ((selected: boolean) => void) | null = null;
  private status: HTMLDivElement;

  constructor(private element: HTMLElement) {
    this.status = element.ownerDocument.createElement("div");
    this.status.className = "term-selection-status";
    this.status.setAttribute("role", "status");
    element.appendChild(this.status);
    const doc = element.ownerDocument;
    doc.addEventListener("pointerdown", this.onPointerDown, true);
    doc.addEventListener("focusin", this.onFocus);
    doc.addEventListener("selectionchange", this.onSelectionChange);
  }

  get pending(): boolean {
    return this.resolve !== null;
  }

  get active(): boolean {
    return this.pending || this.text !== null;
  }

  getText(): string | null {
    this.onSelectionChange();
    return this.text;
  }

  select(): Promise<boolean> {
    const doc = this.element.ownerDocument;
    owners.get(doc)?.clear();
    this.clear();
    owners.set(doc, this);
    // Removing a collapsed textarea caret makes Chromium scroll it back into
    // view on the next key event, overriding the terminal's scroll position.
    const native = doc.getSelection();
    if (native && !native.isCollapsed) native.removeAllRanges();
    this.status.textContent = "Selecting terminal text…";
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /** WTerm calls this only once its current frame has painted. */
  resume(core: TerminalCore): void {
    if (!this.pending || this.scan) return;
    const scan = (this.scan = scanSelection(core));
    const tick = () => {
      this.timer = null;
      const deadline = performance.now() + 4;
      try {
        for (let batch = 0; batch < 32; batch++) {
          const next = scan.next();
          if (next.done) {
            this.scan = null;
            this.text = next.value;
            this.element.classList.add("term-select-all");
            this.status.textContent = "";
            const resolve = this.resolve;
            this.resolve = null;
            resolve?.(true);
            return;
          }
          if (performance.now() >= deadline) break;
        }
        this.timer = setTimeout(tick, 0);
      } catch {
        this.clear();
        this.status.textContent =
          "Unable to select all text. Select a smaller range to copy.";
      }
    };
    this.timer = setTimeout(tick, 0);
  }

  clear(message = ""): void {
    if (!this.active && !this.status.textContent && !message) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.scan?.return("");
    this.scan = null;
    this.text = null;
    this.element.classList.remove("term-select-all");
    this.status.textContent = message;
    if (owners.get(this.element.ownerDocument) === this)
      owners.delete(this.element.ownerDocument);
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(false);
  }

  invalidate(): void {
    if (!this.active) return;
    this.clear(
      this.pending ? "Terminal changed. Select all again to copy." : "",
    );
  }

  private onPointerDown = (event: PointerEvent) => {
    // A secondary click should not discard a pending keyboard Copy.
    if (event.button === 2 && this.element.contains(event.target as Node))
      return;
    this.clear();
  };

  private onFocus = (event: FocusEvent) => {
    if (!this.element.contains(event.target as Node)) this.clear();
  };

  private onSelectionChange = () => {
    if (!this.active) return;
    const doc = this.element.ownerDocument;
    const active = doc.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
    ) {
      const input = active as HTMLInputElement | HTMLTextAreaElement;
      if (input.selectionStart !== input.selectionEnd) {
        this.clear();
        return;
      }
    }
    const selection = doc.getSelection();
    if (selection && !selection.isCollapsed) this.clear();
  };

  destroy(): void {
    this.clear();
    const doc = this.element.ownerDocument;
    doc.removeEventListener("pointerdown", this.onPointerDown, true);
    doc.removeEventListener("focusin", this.onFocus);
    doc.removeEventListener("selectionchange", this.onSelectionChange);
    this.status.remove();
  }
}
