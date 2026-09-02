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

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
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
  private canvases = new Map<string, HTMLCanvasElement>();
  private cache = new Map<string, CachedImage>();
  private generation = -1;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setup(): void {
    this.destroy();
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
      return;
    }

    let state: TerminalGraphicsState | null;
    try {
      state = getState.call(core);
    } catch {
      this.clearCanvases();
      return;
    }
    if (
      !state ||
      !Number.isSafeInteger(state.generation) ||
      !Array.isArray(state.images) ||
      !Array.isArray(state.placements)
    ) {
      this.clearCanvases();
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
    const visible = this.visiblePlacements(core, state, viewport, descriptors);
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
        canvas.remove();
        this.canvases.delete(key);
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
          painted = this.paint(canvas, cached.data, placement, viewport);
        } catch {
          painted = false;
        }
        if (!painted) {
          canvas.remove();
          this.canvases.delete(key);
        }
      } else {
        this.position(canvas, placement, viewport);
      }
    }
  }

  destroy(): void {
    this.clearCanvases();
    this.layer?.remove();
    this.layer = null;
    this.cache.clear();
    this.generation = -1;
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
    for (const canvas of this.canvases.values()) canvas.remove();
    this.canvases.clear();
    this.cache.clear();
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
    const first = Math.max(
      0,
      Math.floor(viewport.scrollTop / viewport.rowHeight) -
        viewport.overscanRows,
    );
    const last = Math.min(
      totalRows,
      Math.ceil(
        (viewport.scrollTop +
          Math.max(viewport.clientHeight, viewport.rowHeight)) /
          viewport.rowHeight,
      ) + viewport.overscanRows,
    );
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
      );
      if (!size) return false;
      const placementRows = Math.max(
        1,
        Math.ceil((placement.offsetY + size.height) / viewport.rowHeight),
      );
      if (!Number.isSafeInteger(placementRows)) return false;
      const placementEnd = placement.row + placementRows;
      return (
        Number.isSafeInteger(placementEnd) &&
        placement.row < last &&
        placementEnd > first
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
  ): void {
    const left = placement.col * viewport.charWidth + placement.offsetX;
    const top = placement.row * viewport.rowHeight + placement.offsetY;
    if (Number.isFinite(left)) canvas.style.left = `${left}px`;
    if (Number.isFinite(top)) canvas.style.top = `${top}px`;
  }

  private paint(
    canvas: HTMLCanvasElement,
    image: TerminalImageData,
    placement: TerminalImagePlacement,
    viewport: GraphicsViewport,
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
    );
    if (!destination) return false;
    const { width: destinationWidth, height: destinationHeight } = destination;

    const pixelWidth = Math.max(1, Math.ceil(destinationWidth));
    const pixelHeight = Math.max(1, Math.ceil(destinationHeight));
    if (
      !Number.isSafeInteger(pixelWidth) ||
      !Number.isSafeInteger(pixelHeight) ||
      pixelWidth > 32768 ||
      pixelHeight > 32768
    )
      return false;
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    this.position(canvas, placement, viewport);
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
    return { width: destinationWidth, height: destinationHeight };
  }
}
