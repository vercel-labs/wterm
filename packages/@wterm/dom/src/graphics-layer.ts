import type {
  TerminalCore,
  TerminalGraphicsState,
  TerminalImageData,
  TerminalImagePlacement,
} from "@wterm/core";

interface GraphicsViewport {
  scrollTop: number;
  clientHeight: number;
  rowHeight: number;
  charWidth: number;
  overscanRows: number;
  scrollbackCount: number;
}

interface CachedImage {
  data: TerminalImageData;
  refs: number;
}

/**
 * Keep browser-owned image backing stores bounded independently of the core's
 * decoded image budget. This is deliberately a fixed layer limit: placement
 * geometry is terminal output and must not be allowed to choose an arbitrary
 * amount of browser memory.
 */
const GRAPHICS_CANVAS_BUDGET_BYTES = 32 * 1024 * 1024;
const MAX_CANVAS_DIMENSION = 32768;

export interface GraphicsLayerOptions {
  /** Maximum rendered image width in CSS pixels. */
  maxImageWidth?: number;
  /** Maximum rendered image height in CSS pixels. */
  maxImageHeight?: number;
}

function finitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function safeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function safeProduct(...values: number[]): number | null {
  let result = 1;
  for (const value of values) {
    if (!safeNonNegativeInteger(value)) return null;
    result *= value;
    if (!Number.isSafeInteger(result)) return null;
  }
  return result;
}

function placementKey(placement: TerminalImagePlacement): string {
  return `${placement.placementKey}:${placement.imageId}:${placement.imageVersion}`;
}

/** Browser-owned canvas overlay for cores that expose normalized terminal images. */
export class GraphicsLayer {
  private container: HTMLElement;
  private layer: HTMLDivElement | null = null;
  private flowSpacer: HTMLDivElement | null = null;
  private canvases = new Map<string, HTMLCanvasElement>();
  private canvasAllocations = new Map<string, number>();
  private canvasBytes = 0;
  private cache = new Map<string, CachedImage>();
  private generation = -1;
  private maxImageWidth: number | undefined;
  private maxImageHeight: number | undefined;
  private flowRows = new Map<number, number>();

  constructor(container: HTMLElement, options: GraphicsLayerOptions = {}) {
    this.container = container;
    this.maxImageWidth = finitePositive(options.maxImageWidth)
      ? options.maxImageWidth
      : undefined;
    this.maxImageHeight = finitePositive(options.maxImageHeight)
      ? options.maxImageHeight
      : undefined;
  }

  setup(): void {
    this.destroy();
    const flowSpacer = document.createElement("div");
    flowSpacer.className = "term-image-flow-spacer";
    flowSpacer.setAttribute("aria-hidden", "true");
    this.container.appendChild(flowSpacer);
    this.flowSpacer = flowSpacer;

    const layer = document.createElement("div");
    layer.className = "term-images";
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("role", "presentation");
    this.container.appendChild(layer);
    this.layer = layer;
    this.generation = -1;
  }

  reconcile(core: TerminalCore, viewport: GraphicsViewport): void {
    const getState = core.getGraphicsState;
    const getImage = core.getGraphicsImage;
    if (!getState || !getImage || !this.layer) {
      this.clearCanvases();
      this.clearFlowReservations();
      return;
    }

    let state: TerminalGraphicsState | null;
    try {
      state = getState.call(core);
    } catch {
      this.clearCanvases();
      this.clearFlowReservations();
      return;
    }
    if (
      !state ||
      !Number.isSafeInteger(state.generation) ||
      !Array.isArray(state.images) ||
      !Array.isArray(state.placements)
    ) {
      this.clearCanvases();
      this.clearFlowReservations();
      return;
    }

    const descriptors = new Map<string, (typeof state.images)[number]>();
    for (const image of state.images) {
      if (
        Number.isSafeInteger(image.imageId) &&
        image.imageId > 0 &&
        Number.isSafeInteger(image.version) &&
        image.version > 0 &&
        Number.isSafeInteger(image.width) &&
        Number.isSafeInteger(image.height) &&
        image.width > 0 &&
        image.height > 0
      ) {
        descriptors.set(`${image.imageId}:${image.version}`, image);
      }
    }
    const bounds = this.visiblePixelArea(core, viewport);
    const flowOffsets = bounds
      ? this.reconcileFlowReservations(
          core,
          state,
          viewport,
          descriptors,
          bounds,
        )
      : new Map<number, number>();
    if (!bounds) this.clearFlowReservations();
    const visible = bounds
      ? this.visiblePlacements(
          core,
          state,
          viewport,
          descriptors,
          bounds,
          flowOffsets,
        )
      : [];
    const wanted = new Set<string>();
    const refs = new Map<string, number>();
    for (const placement of visible) {
      const key = placementKey(placement);
      const imageKey = `${placement.imageId}:${placement.imageVersion}`;
      if (!descriptors.has(imageKey)) continue;
      wanted.add(key);
      refs.set(imageKey, (refs.get(imageKey) ?? 0) + 1);
    }

    const changed = state.generation !== this.generation;
    this.generation = state.generation;

    for (const [key, canvas] of this.canvases) {
      if (!wanted.has(key)) {
        this.removeCanvas(key);
      }
    }

    for (const [key, cached] of this.cache) {
      if (!refs.has(key)) this.cache.delete(key);
      else cached.refs = refs.get(key)!;
    }

    for (const placement of visible) {
      const key = placementKey(placement);
      const imageKey = `${placement.imageId}:${placement.imageVersion}`;
      if (!wanted.has(key)) continue;
      const descriptor = descriptors.get(imageKey);
      if (!descriptor) continue;

      let cached = this.cache.get(imageKey);
      if (!cached) {
        let data: TerminalImageData | null;
        try {
          data = getImage.call(core, placement.imageId, placement.imageVersion);
        } catch {
          data = null;
        }
        if (
          !data ||
          !this.validImage(data, descriptor.width, descriptor.height)
        )
          continue;
        cached = { data, refs: refs.get(imageKey) ?? 0 };
        this.cache.set(imageKey, cached);
      }

      const existingCanvas = this.canvases.get(key);
      const canvas = existingCanvas ?? this.createCanvas(key);
      if (!canvas) continue;
      if (changed || !existingCanvas) {
        let painted = false;
        try {
          painted = this.paint(
            canvas,
            key,
            cached.data,
            placement,
            viewport,
            bounds,
            flowOffsets.get(placement.row) ?? 0,
          );
        } catch {
          painted = false;
        }
        if (!painted) {
          this.removeCanvas(key);
        }
      } else {
        this.position(
          canvas,
          placement,
          viewport,
          flowOffsets.get(placement.row) ?? 0,
        );
      }
    }
  }

  destroy(): void {
    this.clearCanvases();
    this.layer?.remove();
    this.flowSpacer?.remove();
    this.layer = null;
    this.flowSpacer = null;
    this.cache.clear();
    this.generation = -1;
    this.clearFlowReservations();
  }

  private createCanvas(key: string): HTMLCanvasElement | null {
    if (!this.layer) return null;
    const canvas = document.createElement("canvas");
    canvas.className = "term-image";
    canvas.setAttribute("aria-hidden", "true");
    canvas.tabIndex = -1;
    canvas.draggable = false;
    this.layer.appendChild(canvas);
    this.canvases.set(key, canvas);
    return canvas;
  }

  private clearCanvases(): void {
    for (const key of this.canvases.keys()) this.removeCanvas(key);
    this.canvasAllocations.clear();
    this.canvasBytes = 0;
    this.cache.clear();
  }

  private removeCanvas(key: string): void {
    this.canvases.get(key)?.remove();
    this.canvases.delete(key);
    const bytes = this.canvasAllocations.get(key) ?? 0;
    this.canvasAllocations.delete(key);
    this.canvasBytes = Math.max(0, this.canvasBytes - bytes);
  }

  /**
   * An implicit Kitty placement has zero cell rows in its metadata. The
   * terminal core still advances the shell cursor independently, so an
   * absolute canvas alone would let the next prompt paint underneath it.
   * Move the placement's row below the image while keeping the image itself
   * anchored at the row where Kitty placed it. Transforms preserve the
   * terminal screen's existing scroll geometry while changing the visual
   * flow of rows after the image.
   */
  private reconcileFlowReservations(
    core: TerminalCore,
    state: TerminalGraphicsState,
    viewport: GraphicsViewport,
    descriptors: Map<string, (typeof state.images)[number]>,
    bounds: { width: number; height: number },
  ): Map<number, number> {
    let totalRows: number;
    let screenRows: number;
    try {
      screenRows = core.getRows();
      totalRows = viewport.scrollbackCount + screenRows;
    } catch {
      if (this.flowRows.size > 0) this.clearFlowReservations();
      return new Map();
    }
    if (
      !Number.isSafeInteger(screenRows) ||
      screenRows < 0 ||
      !Number.isSafeInteger(totalRows) ||
      totalRows < 0
    ) {
      if (this.flowRows.size > 0) this.clearFlowReservations();
      return new Map();
    }

    const reservations = new Map<number, number>();
    for (const placement of state.placements) {
      if (!this.validPlacement(placement, totalRows)) continue;
      if (placement.rows !== 0) continue;
      // Scrollback rows are virtualized independently and do not participate
      // in the active viewport's normal flow. Their retained coordinates are
      // still used for canvas positioning when they are visible.
      if (placement.row < viewport.scrollbackCount) continue;

      const image = descriptors.get(
        `${placement.imageId}:${placement.imageVersion}`,
      );
      if (!image) continue;
      const size = this.destinationSize(
        placement,
        placement.sourceWidth || image.width,
        placement.sourceHeight || image.height,
        viewport,
        bounds,
      );
      if (!size) continue;
      const reserve = placement.offsetY + size.height;
      if (!finitePositive(reserve)) continue;
      reservations.set(
        placement.row,
        Math.max(reservations.get(placement.row) ?? 0, reserve),
      );
    }

    // Most renders have no implicit placements. Keep that common path
    // constant-time with respect to retained scrollback: there is no need to
    // clear or rebuild row transforms when no flow reservation exists.
    if (reservations.size === 0) {
      if (this.flowRows.size > 0) this.clearFlowReservations();
      return new Map();
    }

    this.clearFlowReservations();

    const rows = this.container.querySelectorAll<HTMLElement>(
      ".term-row:not(.term-scrollback-row)",
    );
    for (const row of rows) row.style.transform = "";

    const flowOffsets = new Map<number, number>();
    let offset = 0;
    const scrollbackCount = viewport.scrollbackCount;
    for (let viewportRow = 0; viewportRow < screenRows; viewportRow++) {
      const row = scrollbackCount + viewportRow;
      if (offset > 0) flowOffsets.set(row, offset);
      const reserve = reservations.get(row) ?? 0;
      const rowElement = rows[viewportRow];
      // The row that owns an implicit placement is also where many terminal
      // programs leave the following prompt. Shift that row by the image's
      // height, while leaving the canvas at the row's original anchor.
      const rowOffset = offset + reserve;
      if (rowElement && rowOffset > 0)
        rowElement.style.transform = `translateY(${rowOffset}px)`;
      offset += reserve;
    }
    if (this.flowSpacer) this.flowSpacer.style.height = `${offset}px`;
    this.container.parentElement?.classList.toggle(
      "has-image-flow",
      offset > 0,
    );
    this.flowRows = reservations;
    return flowOffsets;
  }

  private clearFlowReservations(): void {
    if (this.flowRows.size === 0) {
      this.flowSpacer?.style.setProperty("height", "0px");
      this.container.parentElement?.classList.remove("has-image-flow");
      return;
    }
    const rows = this.container.querySelectorAll<HTMLElement>(
      ".term-row:not(.term-scrollback-row)",
    );
    for (const row of rows) row.style.transform = "";
    if (this.flowSpacer) this.flowSpacer.style.height = "0px";
    this.container.parentElement?.classList.remove("has-image-flow");
    this.flowRows.clear();
  }

  private validImage(
    data: TerminalImageData,
    expectedWidth: number,
    expectedHeight: number,
  ): boolean {
    const byteLength = safeProduct(data.width, data.height, 4);
    return (
      Number.isSafeInteger(data.width) &&
      Number.isSafeInteger(data.height) &&
      data.width > 0 &&
      data.height > 0 &&
      data.width === expectedWidth &&
      data.height === expectedHeight &&
      data.rgba instanceof Uint8Array &&
      byteLength !== null &&
      data.rgba.byteLength === byteLength
    );
  }

  private visiblePlacements(
    core: TerminalCore,
    state: TerminalGraphicsState,
    viewport: GraphicsViewport,
    descriptors: Map<string, (typeof state.images)[number]>,
    bounds: { width: number; height: number },
    flowOffsets: Map<number, number>,
  ): TerminalImagePlacement[] {
    if (
      !finitePositive(viewport.rowHeight) ||
      !finitePositive(viewport.charWidth) ||
      !Number.isFinite(viewport.scrollTop)
    )
      return [];
    let totalRows: number;
    try {
      totalRows = viewport.scrollbackCount + core.getRows();
    } catch {
      return [];
    }
    if (!Number.isSafeInteger(totalRows) || totalRows < 0) return [];
    const viewportStart =
      viewport.scrollTop - viewport.overscanRows * viewport.rowHeight;
    const viewportEnd =
      viewport.scrollTop +
      Math.max(viewport.clientHeight, viewport.rowHeight) +
      viewport.overscanRows * viewport.rowHeight;
    return state.placements.filter((placement) => {
      if (!this.validPlacement(placement, totalRows)) return false;
      const image = descriptors.get(
        `${placement.imageId}:${placement.imageVersion}`,
      );
      if (!image) return false;
      const size = this.destinationSize(
        placement,
        placement.sourceWidth || image.width,
        placement.sourceHeight || image.height,
        viewport,
        bounds,
      );
      if (!size) return false;
      const placementTop =
        placement.row * viewport.rowHeight +
        placement.offsetY +
        (flowOffsets.get(placement.row) ?? 0);
      const placementEnd = placementTop + size.height;
      return (
        Number.isFinite(placementTop) &&
        Number.isFinite(placementEnd) &&
        placementTop < viewportEnd &&
        placementEnd > viewportStart
      );
    });
  }

  private validPlacement(
    placement: TerminalImagePlacement,
    totalRows: number,
  ): boolean {
    return (
      typeof placement.placementKey === "string" &&
      placement.placementKey.length > 0 &&
      safeNonNegativeInteger(placement.imageId) &&
      placement.imageId > 0 &&
      safeNonNegativeInteger(placement.imageVersion) &&
      placement.imageVersion > 0 &&
      safeNonNegativeInteger(placement.row) &&
      placement.row < totalRows &&
      safeNonNegativeInteger(placement.col) &&
      safeNonNegativeInteger(placement.offsetX) &&
      safeNonNegativeInteger(placement.offsetY) &&
      safeNonNegativeInteger(placement.sourceX) &&
      safeNonNegativeInteger(placement.sourceY) &&
      safeNonNegativeInteger(placement.sourceWidth) &&
      safeNonNegativeInteger(placement.sourceHeight) &&
      safeNonNegativeInteger(placement.columns) &&
      safeNonNegativeInteger(placement.rows) &&
      Number.isSafeInteger(placement.z) &&
      Number.isSafeInteger(placement.row + (placement.rows || 1))
    );
  }

  private position(
    canvas: HTMLCanvasElement,
    placement: TerminalImagePlacement,
    viewport: GraphicsViewport,
    flowOffset = 0,
  ): void {
    // Kitty's implicit (auto-sized) placement is a flow item rather than a
    // cell-positioned image. Ghostty can retain it at the cursor's next cell
    // after the transfer completes, so align it to the terminal content
    // origin. Explicit placements retain their protocol coordinates.
    const left =
      placement.rows === 0
        ? placement.offsetX
        : placement.col * viewport.charWidth + placement.offsetX;
    const top =
      placement.row * viewport.rowHeight + placement.offsetY + flowOffset;
    if (Number.isFinite(left)) canvas.style.left = `${left}px`;
    if (Number.isFinite(top)) canvas.style.top = `${top}px`;
  }

  private paint(
    canvas: HTMLCanvasElement,
    key: string,
    image: TerminalImageData,
    placement: TerminalImagePlacement,
    viewport: GraphicsViewport,
    bounds: { width: number; height: number } | null,
    flowOffset = 0,
  ): boolean {
    if (!this.validPlacement(placement, Number.MAX_SAFE_INTEGER)) return false;
    const sourceX = placement.sourceX;
    const sourceY = placement.sourceY;
    const sourceWidth = placement.sourceWidth || image.width;
    const sourceHeight = placement.sourceHeight || image.height;
    if (
      !Number.isSafeInteger(sourceX) ||
      !Number.isSafeInteger(sourceY) ||
      !Number.isSafeInteger(sourceWidth) ||
      !Number.isSafeInteger(sourceHeight) ||
      sourceX < 0 ||
      sourceY < 0 ||
      sourceWidth <= 0 ||
      sourceHeight <= 0 ||
      sourceX + sourceWidth > image.width ||
      sourceY + sourceHeight > image.height
    )
      return false;

    const destination = this.destinationSize(
      placement,
      sourceWidth,
      sourceHeight,
      viewport,
      bounds,
    );
    if (!destination) return false;
    const { width: destinationWidth, height: destinationHeight } = destination;

    const pixelWidth = Math.max(1, Math.ceil(destinationWidth));
    const pixelHeight = Math.max(1, Math.ceil(destinationHeight));
    if (
      !Number.isSafeInteger(pixelWidth) ||
      !Number.isSafeInteger(pixelHeight) ||
      pixelWidth > MAX_CANVAS_DIMENSION ||
      pixelHeight > MAX_CANVAS_DIMENSION
    )
      return false;
    const allocationBytes = safeProduct(pixelWidth, pixelHeight, 4);
    if (
      allocationBytes === null ||
      !this.resizeCanvas(canvas, key, pixelWidth, pixelHeight, allocationBytes)
    )
      return false;
    this.position(canvas, placement, viewport, flowOffset);
    canvas.style.width = `${destinationWidth}px`;
    canvas.style.height = `${destinationHeight}px`;
    canvas.style.zIndex = String(placement.z);
    canvas.style.pointerEvents = "none";

    const context = canvas.getContext("2d");
    if (!context) return false;
    const source = document.createElement("canvas");
    source.width = image.width;
    source.height = image.height;
    const sourceContext = source.getContext("2d");
    if (!sourceContext) return false;
    const rgba = new Uint8ClampedArray(image.rgba);
    const imageData =
      typeof ImageData !== "undefined"
        ? new ImageData(rgba, image.width, image.height)
        : (sourceContext.createImageData?.(image.width, image.height) ?? {
            data: rgba,
            width: image.width,
            height: image.height,
          });
    if ("data" in imageData && imageData.data !== rgba)
      imageData.data.set(rgba);
    sourceContext.putImageData(imageData as ImageData, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    context.drawImage(
      source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      pixelWidth,
      pixelHeight,
    );
    return true;
  }

  private destinationSize(
    placement: TerminalImagePlacement,
    sourceWidth: number,
    sourceHeight: number,
    viewport: GraphicsViewport,
    bounds: { width: number; height: number } | null,
  ): { width: number; height: number } | null {
    if (
      !safeNonNegativeInteger(sourceWidth) ||
      !safeNonNegativeInteger(sourceHeight) ||
      sourceWidth <= 0 ||
      sourceHeight <= 0
    )
      return null;

    const width = placement.columns * viewport.charWidth;
    const height = placement.rows * viewport.rowHeight;
    const destinationWidth =
      finitePositive(width) && placement.columns > 0
        ? width
        : finitePositive(height) && placement.rows > 0
          ? height * (sourceWidth / sourceHeight)
          : sourceWidth;
    const destinationHeight =
      finitePositive(height) && placement.rows > 0
        ? height
        : finitePositive(width) && placement.columns > 0
          ? width * (sourceHeight / sourceWidth)
          : sourceHeight;
    if (
      !finitePositive(destinationWidth) ||
      !finitePositive(destinationHeight) ||
      !Number.isFinite(placement.offsetY + destinationHeight)
    )
      return null;

    if (!bounds) return null;
    const scale = Math.min(
      1,
      bounds.width / destinationWidth,
      bounds.height / destinationHeight,
      this.maxImageWidth === undefined
        ? 1
        : this.maxImageWidth / destinationWidth,
      this.maxImageHeight === undefined
        ? 1
        : this.maxImageHeight / destinationHeight,
    );
    if (!finitePositive(scale)) return null;
    return {
      width: destinationWidth * scale,
      height: destinationHeight * scale,
    };
  }

  private visiblePixelArea(
    core: TerminalCore,
    viewport: GraphicsViewport,
  ): { width: number; height: number } | null {
    let cols: number;
    let rows: number;
    try {
      cols = core.getCols();
      rows = core.getRows();
    } catch {
      return null;
    }
    if (
      !safeNonNegativeInteger(cols) ||
      !safeNonNegativeInteger(rows) ||
      cols <= 0 ||
      rows <= 0 ||
      !finitePositive(viewport.charWidth) ||
      !finitePositive(viewport.rowHeight)
    )
      return null;

    const width = cols * viewport.charWidth;
    const height = rows * viewport.rowHeight;
    if (
      !finitePositive(width) ||
      !finitePositive(height) ||
      !Number.isSafeInteger(Math.ceil(width)) ||
      !Number.isSafeInteger(Math.ceil(height))
    )
      return null;

    return {
      width: Math.min(width, MAX_CANVAS_DIMENSION),
      height: Math.min(height, MAX_CANVAS_DIMENSION),
    };
  }

  private resizeCanvas(
    canvas: HTMLCanvasElement,
    key: string,
    width: number,
    height: number,
    bytes: number,
  ): boolean {
    const previousBytes = this.canvasAllocations.get(key) ?? 0;
    const available =
      GRAPHICS_CANVAS_BUDGET_BYTES - this.canvasBytes + previousBytes;
    if (bytes > available) return false;
    try {
      canvas.width = width;
      canvas.height = height;
    } catch {
      return false;
    }
    this.canvasBytes = this.canvasBytes - previousBytes + bytes;
    this.canvasAllocations.set(key, bytes);
    return true;
  }
}
