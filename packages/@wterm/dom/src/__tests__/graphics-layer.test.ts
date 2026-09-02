import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsLayer } from "../graphics-layer.js";
import type { TerminalCore, TerminalGraphicsState } from "@wterm/core";

function coreWith(state: TerminalGraphicsState | null) {
  const rgba = new Uint8Array([255, 0, 0, 255]);
  return {
    getRows: () => 4,
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
});
