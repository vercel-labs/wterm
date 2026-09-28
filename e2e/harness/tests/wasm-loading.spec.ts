import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const body = readFileSync(
  new URL(
    "../../../packages/@wterm/ghostty/wasm/ghostty-vt.wasm",
    import.meta.url,
  ),
);

for (const mime of ["application/wasm", "application/octet-stream"]) {
  test(`Ghostty shares compilation with ${mime} and isolates terminals`, async ({
    page,
  }) => {
    let requests = 0;
    await page.route("**/test-ghostty.wasm", async (route) => {
      requests++;
      await route.fulfill({ body, contentType: mime });
    });
    await page.goto("/wasm-loading.html");
    await page.waitForFunction(() => Boolean(window.ghosttyLoading));
    const result = await page.evaluate(async () => {
      const [a, b] = await Promise.all([
        window.ghosttyLoading.load({ wasmPath: "/test-ghostty.wasm" }),
        window.ghosttyLoading.load({ wasmPath: "/test-ghostty.wasm" }),
      ]);
      try {
        a.init(80, 24);
        b.init(40, 12);
        a.writeString("first\x1b[?1049halt");
        b.writeString("second");
        a.resize(100, 30);
        a.dispose();
        b.writeString(" alive");
        const c = await window.ghosttyLoading.load({
          wasmPath: "/test-ghostty.wasm",
        });
        try {
          c.init(20, 5);
          return {
            text: Array.from({ length: 12 }, (_, col) =>
              String.fromCodePoint(b.getCell(0, col).char),
            ).join(""),
            cols: b.getCols(),
            rows: b.getRows(),
            alt: b.usingAltScreen(),
            fresh: c.getCell(0, 0).char,
          };
        } finally {
          c.dispose();
        }
      } finally {
        a.dispose();
        b.dispose();
      }
    });
    expect(requests).toBe(1);
    expect(result).toEqual({
      text: "second alive",
      cols: 40,
      rows: 12,
      alt: false,
      fresh: 32,
    });
  });
}

test("Ghostty retries a bad response and falls back when streaming fails", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/test-ghostty.wasm", async (route) => {
    requests++;
    await route.fulfill({
      body: requests === 1 ? "<html>missing</html>" : body,
      contentType: "application/wasm",
    });
  });
  await page.goto("/wasm-loading.html");
  await page.waitForFunction(() => Boolean(window.ghosttyLoading));
  const result = await page.evaluate(async () => {
    const load = () =>
      window.ghosttyLoading.load({ wasmPath: "/test-ghostty.wasm" });
    let error = "";
    try {
      await load();
    } catch (value) {
      error = String(value);
    }
    WebAssembly.compileStreaming = async (source) => {
      await (await source).arrayBuffer();
      throw new TypeError("streaming unavailable");
    };
    const core = await load();
    try {
      core.init(80, 24);
      core.writeString("ok");
      return { error, char: core.getCell(0, 0).char };
    } finally {
      core.dispose();
    }
  });
  expect(requests).toBe(2);
  expect(result.error).toContain("did not return a WASM module");
  expect(result.char).toBe(111);
});

const builtinBody = readFileSync(
  new URL("../../../packages/@wterm/core/wasm/wterm.wasm", import.meta.url),
);

for (const source of [
  "embedded",
  "application/wasm",
  "application/octet-stream",
]) {
  test(`built-in cores share ${source} compilation with independent state`, async ({
    page,
  }) => {
    let requests = 0;
    await page.route("**/test-builtin.wasm", async (route) => {
      requests++;
      await route.fulfill({ body: builtinBody, contentType: source });
    });
    await page.goto("/wasm-loading.html");
    await page.waitForFunction(() => Boolean(window.builtinLoading));
    const result = await page.evaluate(async (source) => {
      let compilations = 0;
      const compile = WebAssembly.compile;
      const stream = WebAssembly.compileStreaming;
      WebAssembly.compile = (...args) => {
        compilations++;
        return compile(...args);
      };
      WebAssembly.compileStreaming = (...args) => {
        compilations++;
        return stream(...args);
      };
      const url = source === "embedded" ? undefined : "/test-builtin.wasm";
      const [a, b] = await Promise.all([
        window.builtinLoading.load(url),
        window.builtinLoading.load(url),
      ]);
      a.init(80, 24);
      b.init(40, 12);
      a.writeString("first\x1b[?1049halternate");
      b.writeString("second");
      a.resize(100, 30);
      a.init(20, 5);
      b.writeString(" alive");
      const c = await window.builtinLoading.load(url);
      c.init(20, 5);
      return {
        compilations,
        text: Array.from({ length: 12 }, (_, col) =>
          String.fromCodePoint(b.getCell(0, col).char),
        ).join(""),
        cols: b.getCols(),
        rows: b.getRows(),
        alt: b.usingAltScreen(),
        fresh: c.getCell(0, 0).char,
      };
    }, source);
    expect(requests).toBe(source === "embedded" ? 0 : 1);
    expect(result).toEqual({
      compilations: 1,
      text: "second alive",
      cols: 40,
      rows: 12,
      alt: false,
      fresh: 32,
    });
  });
}
