import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GhosttyCore, type GhosttyOptions } from "../ghostty-core.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const WASM_URL = "https://wterm.test/ghostty-vt.wasm";
const wasmBytes = readFileSync(
  fileURLToPath(new URL("../../wasm/ghostty-vt.wasm", import.meta.url)),
);
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === WASM_URL) {
      return new Response(wasmBytes, {
        headers: { "content-type": "application/wasm" },
      });
    }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

async function newCore(options: GhosttyOptions = {}) {
  const core = await GhosttyCore.load({ wasmPath: WASM_URL, ...options });
  core.init(20, 4);
  return core;
}

function rgbImage(imageId: number, pixel: [number, number, number]): string {
  const data = Buffer.from(pixel).toString("base64");
  return `\x1b_Ga=T,f=24,s=1,v=1,i=${imageId},c=1,r=1;${data}\x1b\\`;
}

describe("GhosttyCore Kitty graphics", () => {
  it("decodes direct RGB data and exposes its pinned placement", async () => {
    const core = await newCore();
    core.writeString(rgbImage(7, [255, 0, 32]));

    const state = core.getGraphicsState();
    expect(state?.images).toEqual([
      expect.objectContaining({ imageId: 7, width: 1, height: 1 }),
    ]);
    const version = state?.images[0].version;
    expect(version).toBeTypeOf("number");
    expect(state?.placements).toHaveLength(1);
    expect(state?.placements[0]).toMatchObject({
      imageId: 7,
      imageVersion: version,
      row: 0,
      col: 0,
      columns: 1,
      rows: 1,
    });
    expect(core.getGraphicsImage(7, version!)).toMatchObject({
      imageId: 7,
      version,
      width: 1,
      height: 1,
      rgba: new Uint8Array([255, 0, 32, 255]),
    });
  });

  it("does not let callers mutate the graphics image lookup metadata", async () => {
    const core = await newCore();
    core.writeString(rgbImage(7, [255, 0, 32]));

    const state = core.getGraphicsState();
    const image = state?.images[0];
    expect(image).toBeDefined();

    image!.width = 2;
    state!.placements[0].sourceWidth = 2;

    expect(core.getGraphicsImage(7, image!.version)).toMatchObject({
      imageId: 7,
      version: image!.version,
      width: 1,
      height: 1,
      rgba: new Uint8Array([255, 0, 32, 255]),
    });
  });

  it("accepts an APC split at every raw write boundary", async () => {
    const core = await newCore();
    const bytes = new TextEncoder().encode(rgbImage(8, [12, 34, 56]));
    for (let i = 0; i < bytes.length; i++) {
      core.writeRaw(bytes.subarray(i, i + 1));
    }

    expect(core.getGraphicsImage(8, 1)?.rgba).toEqual(
      new Uint8Array([12, 34, 56, 255]),
    );
  });

  it("refreshes graphics snapshots lazily after writes", async () => {
    const core = await newCore();
    const getGraphicsState = vi.spyOn(core, "getGraphicsState");

    core.writeString("ordinary text");
    expect(getGraphicsState).not.toHaveBeenCalled();

    core.getGraphicsState();
    expect(getGraphicsState).toHaveBeenCalledTimes(1);
  });

  it("refreshes replacement pixels and removes deleted images", async () => {
    const core = await newCore();
    core.writeString(rgbImage(9, [255, 0, 0]));
    const first = core.getGraphicsState();
    const firstVersion = first?.images[0].version;
    expect(firstVersion).toBeTypeOf("number");

    core.writeString(rgbImage(9, [0, 255, 0]));
    const replacement = core.getGraphicsState();
    const replacementVersion = replacement?.images[0].version;
    expect(replacementVersion).not.toBe(firstVersion);
    expect(core.getGraphicsImage(9, replacementVersion!)?.rgba).toEqual(
      new Uint8Array([0, 255, 0, 255]),
    );
    expect(core.getGraphicsImage(9, firstVersion!)).toBeNull();

    core.writeString("\x1b_Ga=d,d=I,i=9\x1b\\");
    expect(core.getGraphicsState()?.images).toEqual([]);
    expect(core.getGraphicsState()?.placements).toEqual([]);
  });

  it("admits an image after evicting an exact-limit resident image", async () => {
    const core = await newCore({ imageStorageLimit: 3 });

    core.writeString(rgbImage(10, [255, 0, 0]));
    core.writeString(rgbImage(11, [0, 255, 0]));

    expect(core.getGraphicsImage(10, 1)).toBeNull();
    const image = core
      .getGraphicsState()
      ?.images.find((value) => value.imageId === 11);
    expect(image).toBeDefined();
    expect(core.getGraphicsImage(11, image!.version)?.rgba).toEqual(
      new Uint8Array([0, 255, 0, 255]),
    );
    expect(core.getResourceState().graphics).toMatchObject({
      capacity: 3,
      used: 3,
      imageCount: 1,
      placementCount: 1,
      evicted: 1,
      rejected: 0,
    });
  });

  it("keeps version tracking bounded to resident images after eviction", async () => {
    const log = console.log;
    console.log = () => {};
    try {
      const core = await newCore({ imageStorageLimit: 100 });
      const memory = (
        core as unknown as {
          wasm: { exports: { memory: WebAssembly.Memory } };
        }
      ).wasm.exports.memory;
      const initialBytes = memory.buffer.byteLength;

      // Keep this intentionally long: a leak that is invisible in a short
      // burst can still exhaust WASM linear memory over a terminal session.
      for (let id = 1; id <= 100_000; id++) {
        core.writeString(rgbImage(id, [id & 0xff, 0, 0]));
      }

      const resource = core.getResourceState().graphics;
      expect(resource).toMatchObject({
        capacity: 100,
        used: 99,
        imageCount: 33,
        placementCount: 33,
        evicted: 99_967,
      });
      // The image budget bounds pixel storage and the version bookkeeping
      // must not add one retained entry per evicted image.
      expect(memory.buffer.byteLength).toBeLessThan(
        initialBytes + 4 * 1024 * 1024,
      );
    } finally {
      console.log = log;
    }
  }, 30_000);

  it("bounds placement metadata when implicit placements are repeated", async () => {
    const log = console.log;
    console.log = () => {};
    try {
      const core = await newCore({ imageStorageLimit: 100 });
      core.writeString(rgbImage(10, [1, 2, 3]));
      const memory = (
        core as unknown as {
          wasm: { exports: { memory: WebAssembly.Memory } };
        }
      ).wasm.exports.memory;
      const initialBytes = memory.buffer.byteLength;

      for (let i = 0; i < 10_000; i++) {
        core.writeString("\x1b_Ga=p,i=10\x1b\\");
      }

      const resource = core.getResourceState().graphics;
      expect(resource?.placementCount).toBeLessThanOrEqual(4096);
      expect(memory.buffer.byteLength).toBeLessThan(
        initialBytes + 2 * 1024 * 1024,
      );
    } finally {
      console.log = log;
    }
  }, 30_000);

  it("bounds unique image metadata under the default decoded-byte budget", async () => {
    const log = console.log;
    console.log = () => {};
    try {
      const core = await newCore();
      core.writeString(rgbImage(1, [1, 2, 3]));
      const memory = (
        core as unknown as {
          wasm: { exports: { memory: WebAssembly.Memory } };
        }
      ).wasm.exports.memory;
      const initialBytes = memory.buffer.byteLength;

      // Unique 1x1 images use very little decoded storage but must not grow
      // the resident image map without bound.
      for (let id = 2; id <= 16_384; id++) {
        core.writeString(rgbImage(id, [id & 0xff, 0, 0]));
      }

      const resource = core.getResourceState().graphics;
      expect(resource).toMatchObject({
        capacity: 32 * 1024 * 1024,
        used: 4096 * 3,
        imageCount: 4096,
        placementCount: 4096,
        evicted: 0,
      });
      expect(memory.buffer.byteLength).toBeLessThan(
        initialBytes + 4 * 1024 * 1024,
      );
    } finally {
      console.log = log;
    }
  }, 30_000);
});
