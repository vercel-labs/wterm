import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadGhosttyWasm } from "../wasm-bindings.js";

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../../wasm/ghostty-vt.wasm", import.meta.url)),
);

const realFetch = globalThis.fetch;
const realDocument = (globalThis as { document?: unknown }).document;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realDocument === undefined) {
    delete (globalThis as { document?: unknown }).document;
  } else {
    (globalThis as { document?: unknown }).document = realDocument;
  }
});

function respondWith(body: BodyInit, init?: ResponseInit): void {
  globalThis.fetch = (async () => new Response(body, init)) as typeof fetch;
}

describe("loadGhosttyWasm error reporting", () => {
  it("names the cause when a bundler bakes a build-machine path", async () => {
    // What Bun's dev server produces: import.meta.url survives as a file URL
    // into browser code, where fetch reports only "Failed to fetch".
    (globalThis as { document?: unknown }).document = {};

    await expect(loadGhosttyWasm()).rejects.toThrow(/bundler resolved/);
    await expect(loadGhosttyWasm()).rejects.toThrow(/wasmPath/);
  });

  it("leaves an explicit wasmPath alone", async () => {
    (globalThis as { document?: unknown }).document = {};
    respondWith(wasmBytes);

    await expect(
      loadGhosttyWasm("file:///somewhere/ghostty-vt.wasm"),
    ).resolves.toHaveProperty("exports");
  });

  it("reports the status when the URL 404s", async () => {
    respondWith("<!doctype html>not found", {
      status: 404,
      statusText: "Not Found",
    });

    await expect(
      loadGhosttyWasm("https://wterm.test/missing.wasm"),
    ).rejects.toThrow(/404/);
  });

  it("reports a non-WASM body rather than a magic-word error", async () => {
    respondWith("<!doctype html><title>index</title>");

    await expect(
      loadGhosttyWasm("https://wterm.test/index.html"),
    ).rejects.toThrow(/did not return a WASM module/);
  });

  it("still loads a served binary", async () => {
    respondWith(wasmBytes);

    const wasm = await loadGhosttyWasm("https://wterm.test/ghostty-vt.wasm");
    expect(typeof wasm.exports.init).toBe("function");
  });
});
