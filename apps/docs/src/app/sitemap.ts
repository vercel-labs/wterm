import type { MetadataRoute } from "next";
import { geistdocsSource } from "@/lib/geistdocs/source";

export default function sitemap(): MetadataRoute.Sitemap {
  return geistdocsSource.source.getPages("en").map((page) => ({
    url: new URL(page.url, "https://wterm.dev").toString(),
  }));
}
