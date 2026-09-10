import { createProxy } from "@vercel/geistdocs/proxy";
import { config as geistdocsConfig } from "@/lib/geistdocs/config";

export default createProxy({
  config: geistdocsConfig,
  markdownRoutes: [{ from: "/*path", to: "/[lang]/llms.mdx/*path" }],
});

export const config = {
  matcher: [
    "/((?!api(?:/|$)|og(?:/|$)|_next/|favicon.ico|sitemap.xml|robots.txt|wterm.wasm|Geist-Regular.ttf|GeistPixel-Square.ttf).*)",
  ],
};
