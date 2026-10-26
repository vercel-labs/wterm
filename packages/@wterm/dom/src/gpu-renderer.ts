import type { CellData, TerminalCore } from "@wterm/core";

const DEFAULT_COLOR = 256;
const FLAG_BOLD = 0x01;
const FLAG_DIM = 0x02;
const FLAG_ITALIC = 0x04;
const FLAG_UNDERLINE = 0x08;
const FLAG_REVERSE = 0x20;
const FLAG_INVISIBLE = 0x40;
const FLAG_STRIKETHROUGH = 0x80;

// Per-instance decoration bits read by the shader.
const DECO_UNDERLINE = 1;
const DECO_STRIKE = 2;
const DECO_COLOR_GLYPH = 4;
const DECO_CURSOR_BAR = 8;
const DECO_CURSOR_UNDERLINE = 16;
const DECO_CURSOR_HOLLOW = 32;

// Words per instance: cell (col | row << 16), bg rgba, fg rgba, glyph slot,
// block element mask and decorations (mask | deco << 16), span in cells.
const STRIDE = 6;
const ATLAS_SIZE = 2048;
// Shared render target; one browser frame of terminals packs into it.
const TILE_SIZE = 4096;

const VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in uint cell;
layout(location = 2) in uint bg;
layout(location = 3) in uint fg;
layout(location = 4) in uint slot;
layout(location = 5) in uint misc;
layout(location = 6) in uint span;
uniform vec2 cellSize;
uniform vec2 viewSize;
uniform vec2 slotSize;
uniform float atlasSize;
out vec2 vLocal;
out vec2 vUv;
flat out vec4 vBg;
flat out vec4 vFg;
flat out uint vMisc;
flat out float vSpan;
vec4 unpack(uint c) {
  return vec4(float((c >> 24) & 255u), float((c >> 16) & 255u), float((c >> 8) & 255u), float(c & 255u)) / 255.0;
}
void main() {
  float w = float(span);
  vec2 origin = vec2(float(cell & 65535u), float(cell >> 16)) * cellSize;
  vec2 pos = origin + corner * vec2(cellSize.x * w, cellSize.y);
  gl_Position = vec4(pos / viewSize * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  vec2 slotOrigin = vec2(float(slot & 65535u), float(slot >> 16)) * slotSize;
  vUv = (slotOrigin + corner * vec2(slotSize.x * w, slotSize.y)) / atlasSize;
  vLocal = corner * vec2(w, 1.0);
  vBg = unpack(bg);
  vFg = unpack(fg);
  vMisc = misc;
  vSpan = w;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vUv;
flat in vec4 vBg;
flat in vec4 vFg;
flat in uint vMisc;
flat in float vSpan;
uniform sampler2D atlas;
uniform vec2 cellSize;
uniform vec4 cursorColor;
out vec4 color;
float block(uint mask, vec2 p) {
  // Eighths of the cell, bit per region: see blockMask().
  uint kind = mask & 255u;
  uint arg = (mask >> 8) & 255u;
  if (kind == 1u) return step(1.0 - float(arg) / 8.0, p.y);   // lower n/8
  if (kind == 2u) return step(p.x, float(arg) / 8.0);         // left n/8
  if (kind == 3u) return step(p.y, float(arg) / 8.0);         // upper n/8
  if (kind == 4u) return step(1.0 - float(arg) / 8.0, p.x);   // right n/8
  if (kind == 5u) {                                           // quadrants
    uint q = (p.y < 0.5 ? 0u : 2u) + (p.x < 0.5 ? 0u : 1u);
    return float((arg >> q) & 1u);
  }
  if (kind == 6u) return float(arg) / 4.0;                    // shades
  return 0.0;
}
void main() {
  uint mask = vMisc & 65535u;
  uint deco = vMisc >> 16;
  vec4 c = vBg;
  if (mask != 0u) {
    c = mix(vBg, vFg, block(mask, vec2(vLocal.x, vLocal.y)));
  } else {
    vec4 t = texture(atlas, vUv);
    if ((deco & ${DECO_COLOR_GLYPH}u) != 0u) c = vec4(mix(vBg.rgb, t.rgb / max(t.a, 0.001), t.a), 1.0);
    else c = mix(vBg, vFg, t.a);
  }
  float py = vLocal.y * cellSize.y;
  float thick = max(1.0, floor(cellSize.y / 16.0));
  if ((deco & ${DECO_UNDERLINE}u) != 0u && py >= cellSize.y - 2.0 * thick && py < cellSize.y - thick) c = vFg;
  if ((deco & ${DECO_STRIKE}u) != 0u && abs(py - cellSize.y * 0.5) < thick * 0.5 + 0.5) c = vFg;
  float cursorThick = max(2.0, floor(cellSize.x / 8.0));
  if ((deco & ${DECO_CURSOR_BAR}u) != 0u && vLocal.x * cellSize.x < cursorThick) c = cursorColor;
  if ((deco & ${DECO_CURSOR_UNDERLINE}u) != 0u && py >= cellSize.y - cursorThick) c = cursorColor;
  if ((deco & ${DECO_CURSOR_HOLLOW}u) != 0u) {
    vec2 px = vLocal * cellSize;
    float edge = min(min(px.x, cellSize.x - px.x), min(px.y, cellSize.y - px.y));
    if (edge < max(1.0, floor(cellSize.x / 10.0))) c = cursorColor;
  }
  color = c;
}`;

export interface GpuMetrics {
  charWidth: number;
  rowHeight: number;
  fontFamily: string;
  fontSize: number;
}

export interface GpuPalette {
  fg: number;
  bg: number;
  cursor: number;
  ansi: number[];
}

/** Returns the procedural block mask for U+2580–U+259F, or 0 for glyphs. */
function blockMask(cp: number): number {
  if (cp < 0x2580 || cp > 0x259f) return 0;
  const m = (kind: number, arg: number) => kind | (arg << 8);
  if (cp === 0x2580) return m(3, 4);
  if (cp >= 0x2581 && cp <= 0x2588) return m(1, cp - 0x2580);
  if (cp >= 0x2589 && cp <= 0x258f) return m(2, 0x2590 - cp);
  if (cp === 0x2590) return m(4, 4);
  if (cp >= 0x2591 && cp <= 0x2593) return m(6, cp - 0x2590);
  if (cp === 0x2594) return m(3, 1);
  if (cp === 0x2595) return m(4, 1);
  // Quadrants: bit 0 upper-left, 1 upper-right, 2 lower-left, 3 lower-right.
  const quads: Record<number, number> = {
    0x2596: 4,
    0x2597: 8,
    0x2598: 1,
    0x2599: 13,
    0x259a: 9,
    0x259b: 7,
    0x259c: 11,
    0x259d: 2,
    0x259e: 6,
    0x259f: 14,
  };
  return m(5, quads[cp]);
}

function cubeColor(index: number): number {
  if (index < 232) {
    const n = index - 16;
    return (
      ((Math.floor(n / 36) * 51) << 16) |
      (((Math.floor(n / 6) % 6) * 51) << 8) |
      ((n % 6) * 51)
    );
  }
  const level = (index - 232) * 10 + 8;
  return (level << 16) | (level << 8) | level;
}

export type GpuCursor = {
  row: number;
  col: number;
  shape: string;
  visible: boolean;
  focused: boolean;
};

/** Glyph atlas for one font at one device pixel ratio, shared by terminals. */
class GlyphAtlas {
  readonly texture: WebGLTexture;
  readonly slotW: number;
  readonly slotH: number;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private slots = new Map<string, number>();
  private nextSlot = 2;
  private slotsPerRow: number;
  private dirty = true;
  /** Bumped when the atlas is cleared; grids rebuild their slot references. */
  generation = 0;

  constructor(
    private gl: WebGL2RenderingContext,
    private font: { family: string; size: number },
    readonly dpr: number,
    charWidth: number,
    rowHeight: number,
  ) {
    this.slotW = Math.ceil(charWidth * dpr);
    this.slotH = Math.ceil(rowHeight * dpr);
    // Wide glyphs take two adjacent slots, so rows hold an even number.
    this.slotsPerRow = Math.floor(ATLAS_SIZE / this.slotW) & ~1;
    this.canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      ATLAS_SIZE,
      ATLAS_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private clear(): void {
    // Slots 0 and 1 stay empty: blank cells sample nothing.
    this.slots.clear();
    this.nextSlot = 2;
    this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    this.dirty = true;
    this.generation++;
  }

  /** Packed slot coordinate, with bit 31 set for color (emoji) glyphs. */
  slot(text: string, bold: boolean, italic: boolean, wide: boolean): number {
    const key = `${bold ? "b" : ""}${italic ? "i" : ""}${wide ? "w" : ""}${text}`;
    const known = this.slots.get(key);
    if (known !== undefined) return known;
    const span = wide ? 2 : 1;
    if (span === 2 && this.nextSlot % this.slotsPerRow === this.slotsPerRow - 1)
      this.nextSlot++;
    const capacity = this.slotsPerRow * Math.floor(ATLAS_SIZE / this.slotH);
    if (this.nextSlot + span > capacity) this.clear();
    const index = this.nextSlot;
    this.nextSlot += span;
    const x = (index % this.slotsPerRow) * this.slotW;
    const y = Math.floor(index / this.slotsPerRow) * this.slotH;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, this.slotW * span, this.slotH);
    ctx.clip();
    ctx.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}${this.font.size * this.dpr}px ${this.font.family}`;
    // Center the font box in the row the way CSS line-height does.
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fff";
    const fm = ctx.measureText("M");
    const ascent = fm.fontBoundingBoxAscent;
    const descent = fm.fontBoundingBoxDescent;
    ctx.fillText(text, x, y + (this.slotH - (ascent + descent)) / 2 + ascent);
    ctx.restore();
    const color =
      /\p{Extended_Pictographic}/u.test(text) &&
      !/^[\u0000-\u024f]+$/.test(text);
    const coord =
      (index % this.slotsPerRow) | (Math.floor(index / this.slotsPerRow) << 16);
    const packed = color ? (coord | 0x80000000) >>> 0 : coord;
    this.slots.set(key, packed);
    this.dirty = true;
    return packed;
  }

  bind(unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.dirty) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.canvas,
      );
      this.dirty = false;
    }
  }
}

/**
 * One WebGL2 context for every terminal on the page. Browsers keep only about
 * sixteen live contexts, so per-terminal contexts fail on large pane grids.
 */
class GpuContext {
  private static shared: GpuContext | null | undefined;
  readonly gl: WebGL2RenderingContext;
  readonly canvas: OffscreenCanvas;
  readonly program: WebGLProgram;
  readonly quad: WebGLBuffer;
  readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  private atlases = new Map<string, GlyphAtlas>();
  private batch: {
    target: CanvasRenderingContext2D;
    x: number;
    y: number;
    w: number;
    h: number;
  }[] = [];
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  private probe: HTMLDivElement | null = null;
  private probeObserver: ResizeObserver | null = null;
  private flushScheduled = false;
  lost = false;

  static get(): GpuContext | null {
    if (GpuContext.shared === undefined) {
      try {
        GpuContext.shared = GpuContext.create();
      } catch {
        GpuContext.shared = null;
      }
    }
    if (GpuContext.shared?.lost) GpuContext.shared = null;
    return GpuContext.shared;
  }

  private static create(): GpuContext | null {
    if (typeof OffscreenCanvas === "undefined") return null;
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    if (typeof canvas.transferToImageBitmap !== "function") return null;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    return gl ? new GpuContext(canvas, gl) : null;
  }

  private constructor(canvas: OffscreenCanvas, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.program = link(gl, VERTEX, FRAGMENT);
    for (const name of [
      "cellSize",
      "viewSize",
      "slotSize",
      "atlasSize",
      "atlas",
      "cursorColor",
    ])
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
  }

  get contextLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /**
   * Reserves a tile for one terminal's frame. Frames drawn in the same browser
   * frame share one snapshot of the tile canvas, copied out in `flush`.
   */
  tile(w: number, h: number): { x: number; y: number } | null {
    if (w > TILE_SIZE || h > TILE_SIZE) return null;
    if (this.shelfX + w > TILE_SIZE) {
      this.shelfX = 0;
      this.shelfY += this.shelfH;
      this.shelfH = 0;
    }
    if (this.shelfY + h > TILE_SIZE) {
      this.flush();
      return this.tile(w, h);
    }
    const at = { x: this.shelfX, y: this.shelfY };
    this.shelfX += w;
    this.shelfH = Math.max(this.shelfH, h);
    return at;
  }

  present(
    target: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    this.batch.push({ target, x, y, w, h });
    this.scheduleFlush();
  }

  /** Copies every queued tile to its terminal canvas. */
  flush(): void {
    this.flushScheduled = false;
    for (const t of this.batch)
      t.target.drawImage(this.canvas, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
    this.batch.length = 0;
    this.shelfX = 0;
    this.shelfY = 0;
    this.shelfH = 0;
  }

  // Resize observers run after this frame's animation callbacks and before
  // paint, so every terminal that rendered this frame lands in one flush.
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    if (!this.probe) {
      this.probe = document.createElement("div");
      this.probe.style.cssText =
        "position:fixed;left:0;top:0;height:0;width:0;visibility:hidden;pointer-events:none";
      this.probe.setAttribute("aria-hidden", "true");
      this.probeObserver = new ResizeObserver(() => {
        if (this.flushScheduled) this.flush();
      });
    }
    if (!this.probe.isConnected) {
      document.body.appendChild(this.probe);
      this.probeObserver!.observe(this.probe);
    }
    this.probe.style.width = this.probe.style.width === "1px" ? "2px" : "1px";
  }

  atlas(metrics: GpuMetrics, dpr: number): GlyphAtlas {
    const key = `${metrics.fontFamily}|${metrics.fontSize}|${metrics.charWidth}|${metrics.rowHeight}|${dpr}`;
    let atlas = this.atlases.get(key);
    if (!atlas) {
      atlas = new GlyphAtlas(
        this.gl,
        { family: metrics.fontFamily, size: metrics.fontSize },
        dpr,
        metrics.charWidth,
        metrics.rowHeight,
      );
      this.atlases.set(key, atlas);
    }
    return atlas;
  }
}

function link(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
): WebGLProgram {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

/**
 * One terminal's cells on the shared context. Each frame is one instanced
 * draw, handed to this terminal's canvas as an ImageBitmap without a copy.
 */
export class GpuGrid {
  readonly canvas: HTMLCanvasElement;
  private output: CanvasRenderingContext2D;
  private ctx: GpuContext;
  private vao: WebGLVertexArrayObject;
  private instances: WebGLBuffer;
  private atlas: GlyphAtlas | null = null;
  private atlasGeneration = -1;
  private data = new Uint32Array(0);
  private cols = 0;
  private rows = 0;
  private dpr = 1;
  private metrics: GpuMetrics | null = null;
  private palette: GpuPalette | null = null;
  private cursor: GpuCursor | null = null;

  static create(): GpuGrid | null {
    const ctx = GpuContext.get();
    if (!ctx) return null;
    const canvas = document.createElement("canvas");
    const output = canvas.getContext("2d", { alpha: false });
    if (!output) return null;
    try {
      return new GpuGrid(ctx, canvas, output);
    } catch {
      return null;
    }
  }

  private constructor(
    ctx: GpuContext,
    canvas: HTMLCanvasElement,
    output: CanvasRenderingContext2D,
  ) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.output = output;
    canvas.className = "term-gpu-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const gl = ctx.gl;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ctx.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instances = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    for (let i = 0; i < STRIDE; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribIPointer(1 + i, 1, gl.UNSIGNED_INT, STRIDE * 4, i * 4);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
  }

  get contextLost(): boolean {
    return this.ctx.contextLost;
  }

  /** Sizes the canvas and picks the atlas; true when every row must be rebuilt. */
  configure(
    cols: number,
    rows: number,
    metrics: GpuMetrics,
    palette: GpuPalette,
  ): boolean {
    const dpr = window.devicePixelRatio || 1;
    const atlas = this.ctx.atlas(metrics, dpr);
    const paletteChanged =
      !this.palette ||
      this.palette.fg !== palette.fg ||
      this.palette.bg !== palette.bg ||
      this.palette.cursor !== palette.cursor ||
      this.palette.ansi.some((c, i) => c !== palette.ansi[i]);
    const atlasChanged =
      atlas !== this.atlas || atlas.generation !== this.atlasGeneration;
    const sizeChanged =
      cols !== this.cols ||
      rows !== this.rows ||
      dpr !== this.dpr ||
      (metrics !== this.metrics &&
        (metrics.charWidth !== this.metrics?.charWidth ||
          metrics.rowHeight !== this.metrics?.rowHeight));
    this.palette = palette;
    this.metrics = metrics;
    this.atlas = atlas;
    this.atlasGeneration = atlas.generation;
    if (sizeChanged) {
      this.cols = cols;
      this.rows = rows;
      this.dpr = dpr;
      this.data = new Uint32Array(cols * rows * STRIDE);
      const w = cols * metrics.charWidth;
      const h = rows * metrics.rowHeight;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      const gl = this.ctx.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    }
    return sizeChanged || paletteChanged || atlasChanged;
  }

  private rgb(
    index: number,
    rgb: number | undefined,
    fallback: number,
  ): number {
    if (rgb !== undefined) return rgb;
    if (index === DEFAULT_COLOR) return fallback;
    if (index < 16) return this.palette!.ansi[index];
    return cubeColor(index);
  }

  /** Rewrites one row's instances from the core. */
  updateRow(core: TerminalCore, row: number): void {
    const p = this.palette!;
    const atlas = this.atlas!;
    const data = this.data;
    let o = row * this.cols * STRIDE;
    for (let col = 0; col < this.cols; col++, o += STRIDE) {
      const cell: CellData = core.getCell(row, col);
      data[o] = col | (row << 16);
      if (cell.width === 0) {
        data[o + 5] = 0;
        continue;
      }
      const flags = cell.flags;
      let fg = this.rgb(cell.fg, cell.fgRgb, p.fg);
      let bg = this.rgb(cell.bg, cell.bgRgb, p.bg);
      if (flags & FLAG_REVERSE) [fg, bg] = [bg, fg];
      if (flags & FLAG_INVISIBLE) fg = bg;
      // Dim blends toward the background on the CPU so the shader keeps one mix.
      if (flags & FLAG_DIM) fg = blend(fg, bg, 0.5);
      const wide = cell.width === 2 && col + 1 < this.cols;
      const text =
        (cell as CellData & { chars?: string }).chars ??
        (cell.char > 32 ? String.fromCodePoint(cell.char) : "");
      const mask = text.length <= 2 ? blockMask(cell.char) : 0;
      let deco = 0;
      if (flags & FLAG_UNDERLINE) deco |= DECO_UNDERLINE;
      if (flags & FLAG_STRIKETHROUGH) deco |= DECO_STRIKE;
      let slot = 0;
      if (!mask && text) {
        const packed = atlas.slot(
          text,
          (flags & FLAG_BOLD) !== 0,
          (flags & FLAG_ITALIC) !== 0,
          wide,
        );
        slot = packed & 0x7fffffff;
        if (packed & 0x80000000) deco |= DECO_COLOR_GLYPH;
      }
      data[o + 1] = ((bg << 8) | 0xff) >>> 0;
      data[o + 2] = ((fg << 8) | 0xff) >>> 0;
      data[o + 3] = slot;
      data[o + 4] = (mask | (deco << 16)) >>> 0;
      data[o + 5] = wide ? 2 : 1;
    }
  }

  /** The atlas was cleared for space since these rows were written. */
  get atlasStale(): boolean {
    return (
      this.atlas !== null && this.atlas.generation !== this.atlasGeneration
    );
  }

  /** Accepts the current atlas after rebuilding every row against it. */
  acknowledgeAtlas(): void {
    if (this.atlas) this.atlasGeneration = this.atlas.generation;
  }

  /** Whether a grid of this size fits the shared render target. */
  static fits(
    cols: number,
    rows: number,
    charWidth: number,
    rowHeight: number,
  ): boolean {
    const dpr = window.devicePixelRatio || 1;
    return (
      Math.round(cols * charWidth * dpr) <= TILE_SIZE &&
      Math.round(rows * rowHeight * dpr) <= TILE_SIZE
    );
  }

  setCursor(cursor: GpuCursor | null): void {
    this.cursor = cursor;
  }

  draw(): void {
    const ctx = this.ctx;
    if (ctx.contextLost || !this.metrics || !this.atlas) return;
    const gl = ctx.gl;
    const m = this.metrics;
    const width = Math.round(this.cols * m.charWidth * this.dpr);
    const height = Math.round(this.rows * m.rowHeight * this.dpr);
    const tile = ctx.tile(width, height);
    if (!tile) return;
    // GL's origin is bottom-left; tiles are addressed from the top for drawImage.
    gl.viewport(tile.x, TILE_SIZE - tile.y - height, width, height);
    gl.useProgram(ctx.program);
    this.atlas.bind(0);
    gl.uniform1i(ctx.uniforms.atlas, 0);
    gl.uniform2f(
      ctx.uniforms.cellSize,
      m.charWidth * this.dpr,
      m.rowHeight * this.dpr,
    );
    gl.uniform2f(ctx.uniforms.viewSize, width, height);
    gl.uniform2f(ctx.uniforms.slotSize, this.atlas.slotW, this.atlas.slotH);
    gl.uniform1f(ctx.uniforms.atlasSize, ATLAS_SIZE);
    const cur = this.palette!.cursor;
    gl.uniform4f(
      ctx.uniforms.cursorColor,
      ((cur >> 16) & 255) / 255,
      ((cur >> 8) & 255) / 255,
      (cur & 255) / 255,
      1,
    );
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    const c = this.cursor;
    const o =
      c?.visible && c.row < this.rows && c.col < this.cols
        ? (c.row * this.cols + c.col) * STRIDE
        : -1;
    if (o >= 0) {
      const saved = this.data.slice(o, o + STRIDE);
      if (!c!.focused) {
        this.data[o + 4] =
          (this.data[o + 4] | (DECO_CURSOR_HOLLOW << 16)) >>> 0;
      } else if (c!.shape === "block") {
        // Inverted cell: the glyph takes the background over the cursor color.
        this.data[o + 2] = this.data[o + 1];
        this.data[o + 1] = ((cur << 8) | 0xff) >>> 0;
      } else {
        const bit =
          c!.shape === "bar" ? DECO_CURSOR_BAR : DECO_CURSOR_UNDERLINE;
        this.data[o + 4] = (this.data[o + 4] | (bit << 16)) >>> 0;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data);
      this.data.set(saved, o);
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data);
    }
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.cols * this.rows);
    gl.bindVertexArray(null);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    ctx.present(this.output, tile.x, tile.y, width, height);
  }

  destroy(): void {
    const gl = this.ctx.gl;
    gl.deleteBuffer(this.instances);
    gl.deleteVertexArray(this.vao);
    this.canvas.remove();
  }
}

function blend(a: number, b: number, t: number): number {
  const ch = (s: number) =>
    Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
  return ch(16) | ch(8) | ch(0);
}
