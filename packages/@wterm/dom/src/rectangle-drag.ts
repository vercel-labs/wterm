import type { TerminalPosition } from "@wterm/core";

/** Own only an Alt+left drag accepted by the terminal's painted-grid checks. */
export class RectangleDrag {
  private anchor: TerminalPosition | null = null;
  private suppressClick = false;
  private owned = false;
  private lastEvent: MouseEvent | null = null;
  private frame: number | null = null;

  constructor(
    private element: HTMLElement,
    private callbacks: {
      start(event: MouseEvent): TerminalPosition | null;
      position(event: MouseEvent): TerminalPosition | null;
      select(start: TerminalPosition, end: TerminalPosition): boolean;
      clear(): void;
    },
  ) {
    element.addEventListener("mousedown", this.down, true);
    element.addEventListener("click", this.click, true);
    const doc = element.ownerDocument;
    doc.addEventListener("mousemove", this.move, true);
    doc.addEventListener("mouseup", this.up, true);
    doc.addEventListener("keydown", this.key, true);
    doc.addEventListener("focusin", this.focus);
    doc.defaultView?.addEventListener("blur", this.blur);
  }

  private down = (event: MouseEvent) => {
    this.cancel();
    this.owned = false;
    this.suppressClick = false;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const anchor = this.callbacks.start(event);
    if (!anchor || !this.callbacks.select(anchor, anchor)) return;
    this.anchor = anchor;
    this.owned = true;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private update(event: MouseEvent): void {
    const point = this.callbacks.position(event);
    if (this.anchor && (!point || !this.callbacks.select(this.anchor, point)))
      this.callbacks.clear();
  }

  private move = (event: MouseEvent) => {
    if (!this.owned) return;
    if (!(event.buttons & 1)) {
      this.blur();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.update(event);
    this.lastEvent = event;
    this.scheduleScroll();
  };

  private scheduleScroll(): void {
    if (this.frame !== null || !this.anchor || !this.lastEvent) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (!this.anchor || !this.lastEvent) return;
      const rect = this.element.getBoundingClientRect();
      const y = this.lastEvent.clientY;
      const delta =
        y < rect.top
          ? Math.max(-24, y - rect.top)
          : y > rect.bottom
            ? Math.min(24, y - rect.bottom)
            : 0;
      const before = this.element.scrollTop;
      this.element.scrollTop += delta;
      this.update(this.lastEvent);
      if (this.element.scrollTop !== before) this.scheduleScroll();
    });
  }

  private up = (event: MouseEvent) => {
    if (!this.owned || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.update(event);
    this.cancel();
    this.owned = false;
    this.suppressClick = true;
  };

  private click = (event: MouseEvent) => {
    if (!this.suppressClick || event.detail === 0) return;
    this.suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private key = (event: KeyboardEvent) => {
    if (!this.anchor || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancel();
    this.callbacks.clear();
  };

  cancel = (): void => {
    this.anchor = null;
    this.lastEvent = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  };

  private blur = (): void => {
    this.cancel();
    this.owned = false;
  };

  private focus = (event: FocusEvent): void => {
    if (!this.element.contains(event.target as Node)) this.cancel();
  };

  destroy(): void {
    this.cancel();
    this.element.removeEventListener("mousedown", this.down, true);
    this.element.removeEventListener("click", this.click, true);
    const doc = this.element.ownerDocument;
    doc.removeEventListener("mousemove", this.move, true);
    doc.removeEventListener("mouseup", this.up, true);
    doc.removeEventListener("keydown", this.key, true);
    doc.removeEventListener("focusin", this.focus);
    doc.defaultView?.removeEventListener("blur", this.blur);
  }
}
