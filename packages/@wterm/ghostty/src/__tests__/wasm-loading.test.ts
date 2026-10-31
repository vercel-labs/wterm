import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let loadGhosttyWasm: typeof import("../wasm-bindings.js").loadGhosttyWasm;

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../../wasm/ghostty-vt.wasm", import.meta.url)),
);

const realFetch = globalThis.fetch;
const realDocument = (globalThis as { document?: unknown }).document;

beforeEach(async () => {
  vi.resetModules();
  ({ loadGhosttyWasm } = await import("../wasm-bindings.js"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
  if (realDocument === undefined) {
    delete (globalThis as { document?: unknown }).document;
  } else {
    (globalThis as { document?: unknown }).document = realDocument;
  }
});

describe("compiled Ghostty modules", () => {
  const url = "https://wterm.test/shared.wasm";
  const served = () =>
    new Response(wasmBytes, {
      headers: { "Content-Type": "application/wasm" },
    });

  it("shares downloads and streaming compilation but creates independent instances", async () => {
    const response = served();
    const buffered = vi.spyOn(response, "arrayBuffer");
    const fetcher = vi.fn(async () => response);
    globalThis.fetch = fetcher;
    const compile = vi.spyOn(WebAssembly, "compileStreaming");
    const instantiate = vi.spyOn(WebAssembly, "instantiate");
    const first = await Promise.all(
      Array.from({ length: 3 }, () => loadGhosttyWasm(url)),
    );
    const last = await loadGhosttyWasm(url);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(buffered).not.toHaveBeenCalled();
    expect(instantiate).toHaveBeenCalledTimes(4);
    expect(new Set(instantiate.mock.calls.map((call) => call[0])).size).toBe(1);
    expect(new Set([...first, last].map((wasm) => wasm.instance)).size).toBe(4);
    expect(
      new Set([...first, last].map((wasm) => wasm.exports.memory)).size,
    ).toBe(4);
  });

  it.each([
    undefined,
    "application/octet-stream",
    "application/wasm; charset=utf-8",
  ])("uses buffered compilation for content type %s", async (type) => {
    respondWith(wasmBytes, { headers: type ? { "Content-Type": type } : {} });
    const streaming = vi.spyOn(WebAssembly, "compileStreaming");
    const compile = vi.spyOn(WebAssembly, "compile");
    expect((await loadGhosttyWasm(url)).exports.init).toBeTypeOf("function");
    expect(streaming).not.toHaveBeenCalled();
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("loads without streaming support", async () => {
    const assembly = Object.create(WebAssembly);
    assembly.compileStreaming = undefined;
    vi.stubGlobal("WebAssembly", assembly);
    globalThis.fetch = vi.fn(async () => served());
    expect((await loadGhosttyWasm(url)).exports.init).toBeTypeOf("function");
  });

  it("starts compiling before the response body finishes downloading", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        controller.enqueue(wasmBytes.subarray(0, 1024));
      },
    });
    globalThis.fetch = vi.fn(
      async () =>
        new Response(stream, {
          headers: { "Content-Type": "application/wasm" },
        }),
    );
    const compile = vi.spyOn(WebAssembly, "compileStreaming");
    let loaded = false;
    const pending = loadGhosttyWasm(url).then((wasm) => {
      loaded = true;
      return wasm;
    });
    await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
    expect(loaded).toBe(false);
    controller.enqueue(wasmBytes.subarray(1024));
    controller.close();
    expect((await pending).exports.init).toBeTypeOf("function");
  });

  it("falls back using the same response after streaming consumes its copy", async () => {
    const fetcher = vi.fn(async () => served());
    globalThis.fetch = fetcher;
    vi.spyOn(WebAssembly, "compileStreaming").mockImplementation(
      async (response) => {
        await (await response).arrayBuffer();
        throw new TypeError("streaming unsupported");
      },
    );
    expect((await loadGhosttyWasm(url)).exports.init).toBeTypeOf("function");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "http", "html", "invalid"])(
    "retries after a %s failure",
    async (failure) => {
      const fetcher = vi.fn(async () => {
        if (failure === "network") throw new TypeError("network unavailable");
        if (failure === "http") return new Response("missing", { status: 404 });
        return new Response(
          failure === "html"
            ? "<html>fallback</html>"
            : new Uint8Array([0, 97, 115, 109]),
          {
            headers: { "Content-Type": "application/wasm" },
          },
        );
      });
      globalThis.fetch = fetcher;
      const failed = await Promise.allSettled([
        loadGhosttyWasm(url),
        loadGhosttyWasm(url),
      ]);
      expect(failed.map((result) => result.status)).toEqual([
        "rejected",
        "rejected",
      ]);
      if (failure === "html")
        expect((failed[0] as PromiseRejectedResult).reason.message).toContain(
          "did not return a WASM module",
        );
      expect(fetcher).toHaveBeenCalledTimes(1);
      fetcher.mockImplementation(async () => served());
      expect((await loadGhosttyWasm(url)).exports.init).toBeTypeOf("function");
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("resolves relative paths against the current document base", async () => {
    const doc = { baseURI: "https://wterm.test/one/" };
    vi.stubGlobal("document", doc);
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => served());
    globalThis.fetch = fetcher;
    await loadGhosttyWasm("./terminal.wasm");
    await loadGhosttyWasm("https://wterm.test/one/terminal.wasm");
    doc.baseURI = "https://wterm.test/two/";
    await loadGhosttyWasm("./terminal.wasm");
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://wterm.test/one/terminal.wasm",
      "https://wterm.test/two/terminal.wasm",
    ]);
  });

  it("resolves relative paths in workers without a document", async () => {
    vi.stubGlobal("location", { href: "https://wterm.test/worker/index.js" });
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => served());
    globalThis.fetch = fetcher;
    await loadGhosttyWasm("./terminal.wasm");
    await loadGhosttyWasm("https://wterm.test/worker/terminal.wasm");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://wterm.test/worker/terminal.wasm",
    );
  });

  it("does not evict a newer load when an older displaced request fails", async () => {
    let rejectOld!: (error: Error) => void;
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => served());
    fetcher.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    globalThis.fetch = fetcher;
    const old = loadGhosttyWasm(url).catch((error) => error);
    for (let i = 0; i < 4; i++) await loadGhosttyWasm(`${url}?other=${i}`);
    await loadGhosttyWasm(url);
    rejectOld(new Error("old request failed"));
    expect((await old).message).toBe("old request failed");
    await loadGhosttyWasm(url);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("bounds retained modules and keeps recently used URLs", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => served());
    globalThis.fetch = fetcher;
    for (let i = 0; i < 4; i++) await loadGhosttyWasm(`${url}?v=${i}`);
    await loadGhosttyWasm(`${url}?v=0`);
    await loadGhosttyWasm(`${url}?v=4`);
    await loadGhosttyWasm(`${url}?v=0`);
    expect(fetcher).toHaveBeenCalledTimes(5);
    await loadGhosttyWasm(`${url}?v=1`);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("keeps terminal contents, dimensions, modes, and disposal independent", async () => {
    const { GhosttyCore } = await import("../ghostty-core.js");
    const fetcher = vi.fn(async () => served());
    globalThis.fetch = fetcher;
    const [a, b] = await Promise.all([
      GhosttyCore.load({ wasmPath: url }),
      GhosttyCore.load({ wasmPath: url }),
    ]);
    try {
      a.init(80, 24);
      b.init(40, 12);
      a.writeString("first\x1b[?1049halternate");
      b.writeString("second");
      a.resize(100, 30);
      expect(a.usingAltScreen()).toBe(true);
      expect(b.usingAltScreen()).toBe(false);
      expect(b.getCols()).toBe(40);
      a.dispose();
      b.writeString(" alive");
      expect(
        Array.from({ length: 12 }, (_, col) =>
          String.fromCodePoint(b.getCell(0, col).char),
        ).join(""),
      ).toBe("second alive");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
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
