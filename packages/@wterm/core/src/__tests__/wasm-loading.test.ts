import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
let WasmBridge: typeof import("../wasm-bridge.js").WasmBridge;
const wasmBytes = readFileSync(
  new URL("../../wasm/wterm.wasm", import.meta.url),
);

beforeEach(async () => {
  vi.resetModules();
  ({ WasmBridge } = await import("../wasm-bridge.js"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function memory(bridge: InstanceType<typeof WasmBridge>): WebAssembly.Memory {
  return (bridge as unknown as { memory: WebAssembly.Memory }).memory;
}
function respondWith(body: BodyInit, init?: ResponseInit): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, init)),
  );
}

it("imports the embedded binary only for loads without a URL", async () => {
  const imported = vi.fn(() => ({ WASM_BASE64: wasmBytes.toString("base64") }));
  vi.doMock("../wasm-inline.js", imported);
  vi.resetModules();
  try {
    const { WasmBridge: Bridge } = await import("../index.js");
    expect(imported).not.toHaveBeenCalled();
    respondWith(wasmBytes);
    await Bridge.load("https://wterm.test/custom.wasm");
    expect(imported).not.toHaveBeenCalled();
    await Promise.all([Bridge.load(), Bridge.load()]);
    expect(imported).toHaveBeenCalledTimes(1);
  } finally {
    vi.doUnmock("../wasm-inline.js");
  }
});

it("decodes and compiles the embedded binary once across concurrent and later loads", async () => {
  const decode = vi.spyOn(globalThis, "atob");
  const compile = vi.spyOn(WebAssembly, "compile");
  const instantiate = vi.spyOn(WebAssembly, "instantiate");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const bridges = await Promise.all([
    WasmBridge.load(),
    WasmBridge.load(),
    WasmBridge.load(""),
  ]);
  bridges.push(await WasmBridge.load());
  expect(decode).toHaveBeenCalledTimes(1);
  expect(compile).toHaveBeenCalledTimes(1);
  expect(instantiate).toHaveBeenCalledTimes(4);
  expect(fetcher).not.toHaveBeenCalled();
  expect(new Set(bridges.map(memory)).size).toBe(4);
  bridges[0].init(80, 24);
  bridges[1].init(40, 12);
  bridges[0].writeString("first\x1b[?1049halternate");
  bridges[1].writeString("second");
  bridges[0].init(20, 5);
  expect(bridges[1].getCell(0, 0).char).toBe(115);
  expect(bridges[1].getCols()).toBe(40);
  expect(bridges[1].usingAltScreen()).toBe(false);
});

it.each(["decode", "compile"])(
  "retries embedded loading after %s fails",
  async (kind) => {
    const fail =
      kind === "decode"
        ? vi.spyOn(globalThis, "atob").mockImplementationOnce(() => {
            throw new Error("decode failed");
          })
        : vi
            .spyOn(WebAssembly, "compile")
            .mockRejectedValueOnce(new Error("compile failed"));
    const failed = await Promise.allSettled([
      WasmBridge.load(),
      WasmBridge.load(),
    ]);
    expect(failed.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(fail).toHaveBeenCalledTimes(1);
    const bridge = await WasmBridge.load();
    bridge.init(80, 24);
    expect(bridge.getCell(0, 0).char).toBe(32);
  },
);

it("keeps the embedded module when custom URLs are evicted", async () => {
  const decode = vi.spyOn(globalThis, "atob");
  respondWith(wasmBytes);
  await WasmBridge.load();
  for (let i = 0; i < 6; i++)
    await WasmBridge.load(`https://wterm.test/${i}.wasm`);
  await WasmBridge.load();
  expect(decode).toHaveBeenCalledTimes(1);
});

describe("compiled built-in modules", () => {
  const url = "https://wterm.test/shared.wasm";
  const served = () =>
    new Response(wasmBytes, {
      headers: { "Content-Type": "application/wasm" },
    });

  it("shares downloads and streaming compilation but creates independent instances", async () => {
    const decode = vi.spyOn(globalThis, "atob");
    const response = served();
    const buffered = vi.spyOn(response, "arrayBuffer");
    const fetcher = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetcher);
    const compile = vi.spyOn(WebAssembly, "compileStreaming");
    const instantiate = vi.spyOn(WebAssembly, "instantiate");
    const first = await Promise.all(
      Array.from({ length: 3 }, () => WasmBridge.load(url)),
    );
    const last = await WasmBridge.load(url);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(buffered).not.toHaveBeenCalled();
    expect(instantiate).toHaveBeenCalledTimes(4);
    expect(new Set(instantiate.mock.calls.map((call) => call[0])).size).toBe(1);
    expect(new Set([...first, last]).size).toBe(4);
    expect(new Set([...first, last].map(memory)).size).toBe(4);
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "application/octet-stream",
    "application/wasm; charset=utf-8",
  ])("uses buffered compilation for content type %s", async (type) => {
    respondWith(wasmBytes, { headers: type ? { "Content-Type": type } : {} });
    const streaming = vi.spyOn(WebAssembly, "compileStreaming");
    const compile = vi.spyOn(WebAssembly, "compile");
    expect((await WasmBridge.load(url)).init).toBeTypeOf("function");
    expect(streaming).not.toHaveBeenCalled();
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("loads without streaming support", async () => {
    const assembly = Object.create(WebAssembly);
    assembly.compileStreaming = undefined;
    vi.stubGlobal("WebAssembly", assembly);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => served()),
    );
    expect((await WasmBridge.load(url)).init).toBeTypeOf("function");
  });

  it("starts compiling before the response body finishes downloading", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        controller.enqueue(wasmBytes.subarray(0, 1024));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(stream, {
            headers: { "Content-Type": "application/wasm" },
          }),
      ),
    );
    const compile = vi.spyOn(WebAssembly, "compileStreaming");
    let loaded = false;
    const pending = WasmBridge.load(url).then((wasm) => {
      loaded = true;
      return wasm;
    });
    await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
    expect(loaded).toBe(false);
    controller.enqueue(wasmBytes.subarray(1024));
    controller.close();
    expect((await pending).init).toBeTypeOf("function");
  });

  it("falls back using the same response after streaming consumes its copy", async () => {
    const fetcher = vi.fn(async () => served());
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(WebAssembly, "compileStreaming").mockImplementation(
      async (response) => {
        await (await response).arrayBuffer();
        throw new TypeError("streaming unsupported");
      },
    );
    expect((await WasmBridge.load(url)).init).toBeTypeOf("function");
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
      vi.stubGlobal("fetch", fetcher);
      const failed = await Promise.allSettled([
        WasmBridge.load(url),
        WasmBridge.load(url),
      ]);
      expect(failed.map((result) => result.status)).toEqual([
        "rejected",
        "rejected",
      ]);
      if (failure === "http")
        expect((failed[0] as PromiseRejectedResult).reason.message).toContain(
          "404",
        );
      expect(fetcher).toHaveBeenCalledTimes(1);
      fetcher.mockImplementation(async () => served());
      expect((await WasmBridge.load(url)).init).toBeTypeOf("function");
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("resolves relative paths against the current document base", async () => {
    const doc = { baseURI: "https://wterm.test/one/" };
    vi.stubGlobal("document", doc);
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => served());
    vi.stubGlobal("fetch", fetcher);
    await WasmBridge.load("./terminal.wasm");
    await WasmBridge.load("https://wterm.test/one/terminal.wasm");
    doc.baseURI = "https://wterm.test/two/";
    await WasmBridge.load("./terminal.wasm");
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://wterm.test/one/terminal.wasm",
      "https://wterm.test/two/terminal.wasm",
    ]);
  });

  it("resolves relative paths in workers without a document", async () => {
    vi.stubGlobal("location", { href: "https://wterm.test/worker/index.js" });
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => served());
    vi.stubGlobal("fetch", fetcher);
    await WasmBridge.load("./terminal.wasm");
    await WasmBridge.load("https://wterm.test/worker/terminal.wasm");
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
    vi.stubGlobal("fetch", fetcher);
    const old = WasmBridge.load(url).catch((error) => error);
    for (let i = 0; i < 4; i++) await WasmBridge.load(`${url}?other=${i}`);
    await WasmBridge.load(url);
    rejectOld(new Error("old request failed"));
    expect((await old).message).toBe("old request failed");
    await WasmBridge.load(url);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("bounds retained modules and keeps recently used URLs", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => served());
    vi.stubGlobal("fetch", fetcher);
    for (let i = 0; i < 4; i++) await WasmBridge.load(`${url}?v=${i}`);
    await WasmBridge.load(`${url}?v=0`);
    await WasmBridge.load(`${url}?v=4`);
    await WasmBridge.load(`${url}?v=0`);
    expect(fetcher).toHaveBeenCalledTimes(5);
    await WasmBridge.load(`${url}?v=1`);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("keeps terminal contents, dimensions, modes, and resets independent", async () => {
    const fetcher = vi.fn(async () => served());
    vi.stubGlobal("fetch", fetcher);
    const [a, b] = await Promise.all([
      WasmBridge.load(url),
      WasmBridge.load(url),
    ]);
    a.init(80, 24);
    b.init(40, 12);
    a.writeString("first\x1b[?1049halternate");
    b.writeString("second");
    a.resize(100, 30);
    expect(a.usingAltScreen()).toBe(true);
    expect(b.usingAltScreen()).toBe(false);
    expect(b.getCols()).toBe(40);
    a.init(20, 5);
    b.writeString(" alive");
    expect(
      Array.from({ length: 12 }, (_, col) =>
        String.fromCodePoint(b.getCell(0, col).char),
      ).join(""),
    ).toBe("second alive");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
