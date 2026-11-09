// Advances of glyphs in the terminal font, measured once per code point.
//
// Font fallback can give a Unicode glyph a different advance from the cell it
// sits in, so the renderer bounds such cells in spans of their own. A glyph
// that advances exactly as far as ASCII does cannot move later cells, and a
// run of wide glyphs that share one advance can share a span whose letter
// spacing pads each glyph to its two cells. Both save the browser an
// element, a style and an inline-block layout per cell.

const FLAG_BOLD = 0x01;
const FLAG_ITALIC = 0x04;
const MAX_ADVANCES = 4096;
// The canvas must reproduce the DOM's cell width, or its font is not the one
// the rows use.
const CELL_TOLERANCE = 0.05;

/**
 * Letters of left-to-right scripts without contextual shaping or combining
 * marks, so text made of them advances by the sum of its glyphs: Latin, IPA,
 * Greek and Cyrillic.
 */
export function joinsNarrowRuns(cp: number): boolean {
  return (
    (cp >= 0xa1 && cp <= 0x2af && cp !== 0xad) ||
    (cp >= 0x370 && cp <= 0x52f && !(cp >= 0x483 && cp <= 0x489)) ||
    (cp >= 0x1e00 && cp <= 0x1fff)
  );
}

/** Kana, CJK ideographs, Hangul syllables and fullwidth forms. */
export function joinsWideRuns(cp: number): boolean {
  return (
    (cp >= 0x3041 && cp <= 0x30ff && cp !== 0x3099 && cp !== 0x309a) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function variantOf(flags: number): number {
  return (flags & FLAG_BOLD ? 1 : 0) | (flags & FLAG_ITALIC ? 2 : 0);
}

export class GlyphAdvances {
  private context: OffscreenCanvasRenderingContext2D | null | undefined;
  private font = "";
  private cellWidth = 0;
  private fonts: string[] = [];
  /** Advance of ASCII per variant, or NaN when the canvas font is not usable. */
  private ascii: number[] = [];
  private advances = new Map<number, number>();
  private variant = -1;

  /** Measures with the font `style` resolves to; forgets every advance when it changes. */
  setFont(style: CSSStyleDeclaration, cellWidth: number): void {
    const font = `${style.fontSize} ${style.fontFamily}`;
    const weight = style.fontWeight;
    const key = `${style.fontStyle} ${weight} ${font}`;
    if (key === this.font && cellWidth === this.cellWidth) return;
    this.font = key;
    this.cellWidth = cellWidth;
    this.advances.clear();
    this.ascii = [];
    this.variant = -1;
    const italic = style.fontStyle === "normal" ? "" : `${style.fontStyle} `;
    this.fonts = [
      `${italic}${weight} ${font}`,
      `${italic}bold ${font}`,
      `italic ${weight} ${font}`,
      `italic bold ${font}`,
    ];
  }

  /**
   * Advance of a one-code-point glyph in the cell's font variant, in CSS
   * pixels, or undefined when glyphs cannot be measured here.
   */
  advance(cp: number, text: string, flags: number): number | undefined {
    const variant = variantOf(flags);
    const ascii = this.asciiAdvance(variant);
    if (ascii === undefined) return undefined;
    const key = cp * 4 + variant;
    let width = this.advances.get(key);
    if (width === undefined) {
      if (this.advances.size >= MAX_ADVANCES) this.advances.clear();
      width = this.measure(text, variant);
      this.advances.set(key, width);
    }
    return width;
  }

  /** Whether a narrow glyph advances exactly as far as ASCII in its variant. */
  matchesAscii(cp: number, text: string, flags: number): boolean {
    const width = this.advance(cp, text, flags);
    return width !== undefined && width === this.ascii[variantOf(flags)];
  }

  private asciiAdvance(variant: number): number | undefined {
    if (this.ascii[0] === undefined) {
      if (!this.font || !(this.cellWidth > 0)) return undefined;
      this.context ??=
        typeof OffscreenCanvas === "undefined"
          ? null
          : new OffscreenCanvas(1, 1).getContext("2d");
      if (!this.context) return undefined;
      const width = this.measure("W", 0);
      // A font the canvas could not parse measures in its default font.
      this.ascii[0] =
        Math.abs(width - this.cellWidth) > CELL_TOLERANCE ? NaN : width;
    }
    if (Number.isNaN(this.ascii[0])) return undefined;
    return (this.ascii[variant] ??= this.measure("W", variant));
  }

  private measure(text: string, variant: number): number {
    const context = this.context!;
    if (this.variant !== variant) {
      context.font = this.fonts[variant];
      context.fontKerning = "none";
      this.variant = variant;
    }
    return context.measureText(text).width;
  }
}
