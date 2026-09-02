import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsLayer } from "../graphics-layer.js";
import type { TerminalCore, TerminalGraphicsState } from "@wterm/core";

function coreWith(
  state: TerminalGraphicsState | null,
  dimensions: { cols?: number; rows?: number } = {},
) {
  const rgba = new Uint8Array([255, 0, 0, 255]);
  return {
    getCols: () => dimensions.cols ?? 4,
    getRows: () => dimensions.rows ?? 4,
    getScrollbackCount: () => 2,
    getGraphicsState: () => state,
    getGraphicsImage: vi.fn(() => ({
      imageId: 7,
      version: 1,
      width: 1,
      height: 1,
      rgba,
    })),
  } as unknown as TerminalCore & { getGraphicsImage: ReturnType<typeof vi.fn> };
}

const state: TerminalGraphicsState = {
  generation: 1,
  images: [{ imageId: 7, version: 1, width: 1, height: 1 }],
  placements: [
    {
      placementKey: "p",
      imageId: 7,
      imageVersion: 1,
      row: 2,
      col: 3,
      offsetX: 2,
      offsetY: 4,
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 1,
      sourceHeight: 1,
      columns: 2,
      rows: 1,
      z: 4,
    },
  ],
};

describe("GraphicsLayer", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          putImageData: vi.fn(),
          clearRect: vi.fn(),
          drawImage: vi.fn(),
        }) as unknown as CanvasRenderingContext2D,
    );
  });

  it("materializes a decorative canvas at cell and pixel offsets", () => {
    const layer = new GraphicsLayer(container);
    layer.setup();
    const core = coreWith(state);
    layer.reconcile(core, {
      scrollTop: 34,
      clientHeight: 68,
      rowHeight: 17,
      charWidth: 8,
      overscanRows: 0,
      scrollbackCount: 2,
    });

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.style.left).toBe("26px");
    expect(canvas.style.top).toBe("38px");
    expect(canvas.style.width).toBe("16px");
    expect(canvas.style.height).toBe("17px");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.tabIndex).toBe(-1);
    expect(canvas.style.pointerEvents).toBe("none");
  });

  it("filters placements outside the viewport and clears deleted graphics", () => {
    const layer = new GraphicsLayer(container);
    layer.setup();
    const core = coreWith(state);
    layer.reconcile(core, {
      scrollTop: 0,
      clientHeight: 17,
      rowHeight: 17,
      charWidth: 8,
      overscanRows: 0,
      scrollbackCount: 2,
    });
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
    layer.reconcile(core, {
      scrollTop: 34,
      clientHeight: 17,
      rowHeight: 17,
      charWidth: 8,
      overscanRows: 0,
      scrollbackCount: 2,
    });
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    layer.reconcile(coreWith({ generation: 2, images: [], placements: [] }), {
      scrollTop: 34,
      clientHeight: 17,
      rowHeight: 17,
      charWidth: 8,
      overscanRows: 0,
      scrollbackCount: 2,
    });
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("does not render without an optional graphics provider", () => {
    const layer = new GraphicsLayer(container);
    layer.setup();
    layer.reconcile(coreWith(null), {
      scrollTop: 0,
      clientHeight: 100,
      rowHeight: 17,
      charWidth: 8,
      overscanRows: 2,
      scrollbackCount: 0,
    });
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("repositions without repainting when graphics generation is unchanged", () => {
    const layer = new GraphicsLayer(container);
    layer.setup();
    const core = coreWith(state);
    const context = {
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const viewport = {
      scrollTop: 34,
      clientHeight: 17,
      rowHeight: 17,
      charWidth: 8,
      overscanRows: 0,
      scrollbackCount: 2,
    };

    layer.reconcile(core, viewport);
    const initialDraws = context.drawImage.mock.calls.length;
    const initialClears = context.clearRect.mock.calls.length;
    viewport.scrollTop = 51;
    layer.reconcile(core, viewport);

    expect(context.drawImage).toHaveBeenCalledTimes(initialDraws);
    expect(context.clearRect).toHaveBeenCalledTimes(initialClears);
    expect(
      (container.querySelector("canvas") as HTMLCanvasElement).style.top,
    ).toBe("38px");
  });

  it("bounds hostile placement geometry to the terminal pixel area", () => {
    const layer = new GraphicsLayer(container);
    layer.setup();
    layer.reconcile(
      coreWith({
        generation: 1,
        images: [{ imageId: 7, version: 1, width: 1, height: 1 }],
        placements: [
          {
            ...state.placements[0],
            columns: 4_000,
            rows: 2_000,
          },
        ],
      }),
      {
        scrollTop: 0,
        clientHeight: 68,
        rowHeight: 17,
        charWidth: 8,
        overscanRows: 0,
        scrollbackCount: 0,
      },
    );

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(68);
    expect(canvas.style.width).toBe("32px");
    expect(canvas.style.height).toBe("68px");
  });

  it("keeps total visible canvas backing stores within the overlay budget", () => {
    const layer = new GraphicsLayer(container);
    layer.setup();
    const placements = Array.from({ length: 100 }, (_, index) => ({
      ...state.placements[0],
      placementKey: `placement-${index}`,
      columns: 4_000,
      rows: 2_000,
    }));
    layer.reconcile(
      coreWith(
        { generation: 1, images: state.images, placements },
        { cols: 80, rows: 24 },
      ),
      {
        scrollTop: 0,
        clientHeight: 68,
        rowHeight: 17,
        charWidth: 8,
        overscanRows: 0,
        scrollbackCount: 0,
      },
    );

    // Each materialized canvas is bounded by the terminal's 640 * 408 pixel
    // area, and the total backing-store bytes must stay within 32 MiB.
    const canvases = Array.from(container.querySelectorAll("canvas"));
    const backingStoreBytes = canvases.reduce(
      (total, canvas) => total + canvas.width * canvas.height * 4,
      0,
    );
    expect(canvases.length).toBeLessThan(placements.length);
    expect(backingStoreBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  });
});
