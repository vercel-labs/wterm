import { describe, test } from "node:test";
import assert from "node:assert/strict";
const base = process.env.DOCS_TEST_URL;
if (!base) {
  throw new Error(
    "Set DOCS_TEST_URL or run pnpm --filter @wterm/docs test:routes after building the docs.",
  );
}
const routes = [
  "/",
  "/get-started",
  "/configuration",
  "/themes",
  "/api-reference",
  "/react",
  "/vue",
  "/svelte",
  "/vanilla",
  "/ghostty",
  "/just-bash",
  "/markdown",
  "/core",
];
const headers = { "user-agent": "Mozilla/5.0", accept: "text/html" };
const get = (path, options = {}) =>
  fetch(new URL(path, base), { headers, ...options });
describe("Geistdocs public route contract", () => {
  for (const path of routes) {
    test(`${path} preserves HTML, canonical and social metadata`, {
      timeout: 60000,
    }, async () => {
      const response = await get(path);
      assert.strictEqual(response.status, 200);
      assert.ok(response.headers.get("content-type").includes("text/html"));
      const html = await response.text();
      assert.ok(
        html.includes(
          `rel="canonical" href="https://wterm.dev${path === "/" ? "" : path}`,
        ),
      );
      assert.ok(
        html.includes(
          `property="og:image" content="https://wterm.dev/og${path === "/" ? "" : path}"`,
        ),
      );
      assert.strictEqual(html.match(/<h1(?:\s|>)/g)?.length, 1);
      assert.ok(!html.includes("NEXT_HTTP_ERROR_FALLBACK;500"));
    });
    test(`${path} serves Markdown with preserved examples`, {
      timeout: 60000,
    }, async () => {
      const markdownPath = path === "/" ? "/index.md" : `${path}.md`;
      const response = await get(markdownPath);
      assert.strictEqual(response.status, 200);
      assert.ok(response.headers.get("content-type").includes("text/markdown"));
      assert.ok(response.headers.get("link").includes('rel="canonical"'));
      const markdown = await response.text();
      assert.ok(markdown.length > 100);
      assert.ok(markdown.toLowerCase().includes("wterm"));
      assert.ok(!markdown.includes("<!DOCTYPE html>"));
    });
  }
  test("Markdown content negotiation uses the same source", {
    timeout: 60000,
  }, async () => {
    const response = await get("/react", {
      headers: { ...headers, accept: "text/markdown" },
    });
    assert.strictEqual(response.status, 200);
    assert.ok(response.headers.get("content-type").includes("text/markdown"));
    assert.ok((await response.text()).includes("@wterm/react"));
  });
  test("introduction keeps its permanent redirect", async () => {
    const response = await get("/introduction", { redirect: "manual" });
    assert.strictEqual(response.status, 308);
    assert.strictEqual(
      new URL(response.headers.get("location"), base).pathname,
      "/",
    );
  });
  test("sitemap and llms include all public pages", {
    timeout: 60000,
  }, async () => {
    const sitemap = await get("/sitemap.xml");
    assert.strictEqual(sitemap.status, 200);
    const xml = await sitemap.text();
    const llms = await get("/llms.txt");
    assert.strictEqual(llms.status, 200);
    const index = await llms.text();
    assert.strictEqual(index.match(/^title: /gm)?.length, routes.length);
    const semanticSitemap = await get("/sitemap.md");
    assert.strictEqual(semanticSitemap.status, 200);
    const sitemapMarkdown = await semanticSitemap.text();
    for (const path of routes) {
      assert.ok(xml.includes(`https://wterm.dev${path}`));
      assert.ok(sitemapMarkdown.includes(`](${path})`));
    }
    const robots = await get("/robots.txt");
    assert.ok(
      (await robots.text()).includes("Sitemap: https://wterm.dev/sitemap.xml"),
    );
  });
  test("search indexes body content, not only page titles", {
    timeout: 60000,
  }, async () => {
    const response = await get(
      "/api/search?query=WebSocketTransport&locale=en",
    );
    assert.strictEqual(response.status, 200);
    const results = await response.json();
    assert.strictEqual(Array.isArray(results), true);
    assert.strictEqual(
      results.some((result) => result.url.startsWith("/api-reference")),
      true,
    );
  });
  test("search breadcrumbs identify the product without duplicate groups", async () => {
    const response = await get(
      "/api/search?query=WebSocketTransport&locale=en",
    );
    const results = await response.json();
    const page = results.find(
      (result) => result.type === "page" && result.url === "/api-reference",
    );
    assert.deepStrictEqual(page.breadcrumbs, ["wterm", "Documentation"]);
  });
  test("unmatched searches return an empty result set", async () => {
    const response = await get(
      "/api/search?query=zzzyyy-nonexistent-123456&locale=en",
    );
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), []);
  });
  test("API fragment links remain addressable", async () => {
    const response = await get("/api-reference");
    const html = await response.text();
    for (const id of [
      "terminal-options",
      "react-only-props",
      "vue-only-props",
      "vue-events",
      "svelte-only-props",
      "imperative-handle-react",
      "template-ref-vue",
      "imperative-handle-svelte",
      "websockettransport",
      "wasmbridge",
      "wterm-methods",
    ]) {
      assert.ok(html.includes(`id="${id}"`));
    }
  });
  test("unknown HTML and Markdown routes are real 404s", {
    timeout: 60000,
  }, async () => {
    for (const path of ["/not-a-wterm-page", "/not-a-wterm-page.md"]) {
      const response = await get(path);
      assert.strictEqual(response.status, 404);
    }
  });
  test("WASM and OG routes bypass locale rewriting", {
    timeout: 60000,
  }, async () => {
    const wasm = await get("/wterm.wasm");
    assert.strictEqual(wasm.status, 200);
    assert.deepStrictEqual(
      [...new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)],
      [0, 97, 115, 109],
    );
    for (const path of ["/og", "/og/ghostty"]) {
      const response = await get(path);
      assert.strictEqual(response.status, 200);
      assert.ok(response.headers.get("content-type").includes("image/png"));
    }
  });
});
