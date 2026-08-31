import { describe, it, expect, beforeEach } from "vitest";
import { WasmBridge } from "../wasm-bridge.js";

describe("WasmBridge memory growth", () => {
  let bridge: WasmBridge;

  beforeEach(async () => {
    bridge = await WasmBridge.load();
    bridge.init(80, 24);
  });

  describe("writeRaw", () => {
    it("survives WASM memory growth mid-write", () => {
      const mem: WebAssembly.Memory = (bridge as any).memory;
      const originalExports = (bridge as any).exports;
      const originalWriteBytes =
        originalExports.writeBytes.bind(originalExports);

      // Simulate the WASM module growing its own memory in response to a
      // write (e.g. to fit a bigger ring buffer / scrollback). This detaches
      // any ArrayBuffer view created before the growth. WASM export
      // properties are non-configurable, so swap in a plain object copy
      // instead of mutating the original in place.
      const wrapped: Record<string, unknown> = {};
      for (const key of Object.keys(originalExports)) {
        wrapped[key] = (originalExports as Record<string, unknown>)[key];
      }
      wrapped.writeBytes = (len: number) => {
        originalWriteBytes(len);
        mem.grow(1);
      };
      (bridge as any).exports = wrapped;

      // Force multiple loop iterations inside writeRaw (chunk size is 8192).
      const data = new Uint8Array(20000).fill("X".charCodeAt(0));

      expect(() => bridge.writeRaw(data)).not.toThrow();
      expect(bridge.getCell(0, 0).char).toBe(88); // 'X'
    });
  });

  describe("getCell", () => {
    it("survives WASM memory growth after the view was cached", () => {
      bridge.writeString("A");
      const mem: WebAssembly.Memory = (bridge as any).memory;

      // Grow memory independently of resize/init, which is what leaves a
      // cached DataView pointing at a detached ArrayBuffer.
      mem.grow(1);

      expect(() => bridge.getCell(0, 0)).not.toThrow();
      expect(bridge.getCell(0, 0).char).toBe(65); // 'A'
    });
  });

  describe("getScrollbackCell", () => {
    it("survives WASM memory growth after the view was cached", () => {
      for (let i = 0; i < 30; i++) {
        bridge.writeString("A\r\n");
      }
      const count = bridge.getScrollbackCount();
      expect(count).toBeGreaterThan(0);

      const mem: WebAssembly.Memory = (bridge as any).memory;
      mem.grow(1);

      expect(() => bridge.getScrollbackCell(0, 0)).not.toThrow();
      expect(bridge.getScrollbackCell(0, 0).char).toBe(65); // 'A'
    });
  });
});
