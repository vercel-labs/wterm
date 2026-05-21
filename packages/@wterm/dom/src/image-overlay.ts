import type { KittyGraphicsEvent, KittyControl } from "./kitty-graphics.js";

interface Stored {
  /** PNG image bytes. */
  data: Uint8Array;
}

interface Placement {
  el: HTMLImageElement;
  placementId: number;
  imageId: string;
  /** Cell column at top-left of the image. */
  col: number;
  /** Pixel offset from the top of `term-grid` to the image's top edge. */
  topPx: number;
}

const FMT_PNG = 100;

/**
 * Overlay layer that renders inline images (Kitty graphics protocol) on top
 * of the terminal cell grid. Images are positioned absolutely inside the
 * `term-grid` container so they remain aligned with their original content
 * as new lines scroll into history.
 */
export class ImageOverlay {
  private container: HTMLElement;
  private layer: HTMLDivElement;
  /** Source images keyed by `i:` (id) or `I:` (number). */
  private images = new Map<string, Stored>();
  /** Active placements keyed by `${imageId}#${placementId}`. */
  private placements = new Map<string, Placement>();
  private charWidthPx = 0;
  private rowHeightPx = 0;

  constructor(termGridContainer: HTMLElement) {
    this.container = termGridContainer;
    this.layer = document.createElement("div");
    this.layer.className = "term-image-layer";
    this.container.appendChild(this.layer);
  }

  /** Tell the overlay how many CSS pixels one cell occupies. */
  setCellMetrics(charWidthPx: number, rowHeightPx: number): void {
    this.charWidthPx = charWidthPx;
    this.rowHeightPx = rowHeightPx;
  }

  /**
   * Handle an incoming Kitty graphics event. `anchor` describes the current
   * cursor position when the event arrives (used as the placement origin
   * unless overridden by the event's own coordinates).
   */
  handle(
    event: KittyGraphicsEvent,
    anchor: { row: number; col: number; scrollbackCount: number },
  ): void {
    const action = String(event.control.a ?? "T");

    if (action === "d") {
      this._delete(event.control);
      return;
    }

    if (action === "t" || action === "T") {
      this._store(event);
    }

    if (action === "T" || action === "p") {
      this._place(event.control, anchor);
    }
  }

  /** Remove everything. Used on terminal reset / destroy. */
  clear(): void {
    this.images.clear();
    for (const p of this.placements.values()) p.el.remove();
    this.placements.clear();
  }

  destroy(): void {
    this.clear();
    this.layer.remove();
  }

  private _store(event: KittyGraphicsEvent): void {
    const f = event.control.f ?? FMT_PNG;
    if (f !== FMT_PNG) {
      // Only PNG inline transfer is supported in this MVP.
      return;
    }
    const key = imageKey(event.control);
    if (!key) return;
    this.images.set(key, { data: event.data });
  }

  private _place(
    control: KittyControl,
    anchor: { row: number; col: number; scrollbackCount: number },
  ): void {
    const key = imageKey(control);
    if (!key) return;
    const stored = this.images.get(key);
    if (!stored || stored.data.length === 0) return;

    const placementId = typeof control.p === "number" ? control.p : 0;
    const dedupeKey = `${key}#${placementId}`;
    const existing = this.placements.get(dedupeKey);
    if (existing) existing.el.remove();

    const col = anchor.col + (typeof control.X === "number" ? control.X : 0);
    const totalRow =
      anchor.scrollbackCount +
      anchor.row +
      (typeof control.Y === "number" ? control.Y : 0);

    const img = document.createElement("img");
    img.className = "term-image";
    img.draggable = false;
    img.alt = "";
    const blob = new Blob([new Uint8Array(stored.data)], { type: "image/png" });
    img.src = URL.createObjectURL(blob);
    img.addEventListener("load", () => URL.revokeObjectURL(img.src), {
      once: true,
    });

    const topPx = totalRow * this.rowHeightPx;
    const leftPx = col * this.charWidthPx;

    img.style.position = "absolute";
    img.style.top = `${topPx}px`;
    img.style.left = `${leftPx}px`;
    if (typeof control.c === "number" && this.charWidthPx > 0) {
      img.style.width = `${control.c * this.charWidthPx}px`;
    }
    if (typeof control.r === "number" && this.rowHeightPx > 0) {
      img.style.height = `${control.r * this.rowHeightPx}px`;
    }
    if (typeof control.z === "number") {
      img.style.zIndex = String(control.z);
    }

    this.layer.appendChild(img);
    this.placements.set(dedupeKey, {
      el: img,
      placementId,
      imageId: key,
      col,
      topPx,
    });
  }

  private _delete(control: KittyControl): void {
    const specRaw = control.d;
    const spec = typeof specRaw === "string" ? specRaw : "a";
    const lower = spec.toLowerCase();

    // Uppercase variants in the spec mean "also free image data". We treat
    // upper and lower the same here since we don't separately track on-disk
    // resources.
    const removeMatching = (pred: (p: Placement) => boolean): void => {
      for (const [k, p] of this.placements) {
        if (pred(p)) {
          p.el.remove();
          this.placements.delete(k);
        }
      }
    };

    switch (lower) {
      case "a":
        removeMatching(() => true);
        break;
      case "i": {
        const key = imageKey(control);
        if (!key) return;
        removeMatching((p) => p.imageId === key);
        if (spec === "I") this.images.delete(key);
        break;
      }
      default:
        // Other delete specifiers (z-index, range, etc.) not implemented.
        break;
    }
  }
}

function imageKey(control: KittyControl): string | null {
  if (typeof control.i === "number") return `i:${control.i}`;
  if (typeof control.I === "number") return `I:${control.I}`;
  return "i:0";
}
