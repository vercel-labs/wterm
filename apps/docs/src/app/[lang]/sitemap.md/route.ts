import { createSitemapMarkdownRoute } from "@vercel/geistdocs/routes/sitemap";
import { config } from "@/lib/geistdocs/config";
import { geistdocsSource } from "@/lib/geistdocs/source";

export const { GET } = createSitemapMarkdownRoute({
  config,
  source: geistdocsSource,
  title: "wterm documentation",
});
