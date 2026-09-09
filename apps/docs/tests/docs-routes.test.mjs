import { describe, expect, test } from "bun:test";

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
    test(`${path} preserves HTML, canonical and social metadata`, async () => {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain(
        `rel="canonical" href="https://wterm.dev${path === "/" ? "" : path}`,
      );
      expect(html).toContain(
        `property="og:image" content="https://wterm.dev/og${path === "/" ? "" : path}"`,
      );
      expect(html.match(/<h1(?:\s|>)/g)?.length).toBe(1);
      expect(html).not.toContain("NEXT_HTTP_ERROR_FALLBACK;500");
    }, 60000);

    test(`${path} serves Markdown with preserved examples`, async () => {
      const markdownPath = path === "/" ? "/index.md" : `${path}.md`;
      const response = await get(markdownPath);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/markdown");
      expect(response.headers.get("link")).toContain('rel="canonical"');
      const markdown = await response.text();
      expect(markdown.length).toBeGreaterThan(100);
      expect(markdown.toLowerCase()).toContain("wterm");
      expect(markdown).not.toContain("<!DOCTYPE html>");
    }, 60000);
  }

  test("Markdown content negotiation uses the same source", async () => {
    const response = await get("/react", {
      headers: { ...headers, accept: "text/markdown" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toContain("@wterm/react");
  }, 60000);

  test("introduction keeps its permanent redirect", async () => {
    const response = await get("/introduction", { redirect: "manual" });
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location"), base).pathname).toBe("/");
  });

  test("sitemap and llms include all public pages", async () => {
    const sitemap = await get("/sitemap.xml");
    expect(sitemap.status).toBe(200);
    const xml = await sitemap.text();
    const llms = await get("/llms.txt");
    expect(llms.status).toBe(200);
    const index = await llms.text();
    expect(index.match(/^title: /gm)?.length).toBe(routes.length);
    const semanticSitemap = await get("/sitemap.md");
    expect(semanticSitemap.status).toBe(200);
    const sitemapMarkdown = await semanticSitemap.text();
    for (const path of routes) {
      expect(xml).toContain(`https://wterm.dev${path}`);
      expect(sitemapMarkdown).toContain(`](${path})`);
    }
    const robots = await get("/robots.txt");
    expect(await robots.text()).toContain(
      "Sitemap: https://wterm.dev/sitemap.xml",
    );
  }, 60000);

  test("search indexes body content, not only page titles", async () => {
    const response = await get(
      "/api/search?query=WebSocketTransport&locale=en",
    );
    expect(response.status).toBe(200);
    const results = await response.json();
    expect(Array.isArray(results)).toBe(true);
    expect(
      results.some((result) => result.url.startsWith("/api-reference")),
    ).toBe(true);
  }, 60000);

  test("search breadcrumbs identify the product without duplicate groups", async () => {
    const response = await get(
      "/api/search?query=WebSocketTransport&locale=en",
    );
    const results = await response.json();
    const page = results.find(
      (result) => result.type === "page" && result.url === "/api-reference",
    );
    expect(page.breadcrumbs).toEqual(["wterm", "Documentation"]);
  });

  test("unmatched searches return an empty result set", async () => {
    const response = await get(
      "/api/search?query=zzzyyy-nonexistent-123456&locale=en",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
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
      expect(html).toContain(`id="${id}"`);
    }
  });

  test("unknown HTML and Markdown routes are real 404s", async () => {
    for (const path of ["/not-a-wterm-page", "/not-a-wterm-page.md"]) {
      const response = await get(path);
      expect(response.status).toBe(404);
    }
  }, 60000);

  test("WASM and OG routes bypass locale rewriting", async () => {
    const wasm = await get("/wterm.wasm");
    expect(wasm.status).toBe(200);
    expect([...new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)]).toEqual([
      0, 97, 115, 109,
    ]);
    for (const path of ["/og", "/og/ghostty"]) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
    }
  }, 60000);
});
