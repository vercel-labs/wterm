import { defineConfig } from "@vercel/geistdocs/config";

export const config = defineConfig({
  title: "wterm",
  siteUrl: "https://wterm.dev",
  defaultLanguage: "en",
  logo: <span className="font-medium">wterm</span>,
  navbarActiveProduct: "wterm",
  github: {
    owner: "vercel-labs",
    repo: "wterm",
    branch: "main",
    editPath: "apps/docs/content/docs",
  },
  content: [
    { id: "docs", label: "Documentation", dir: "content/docs", route: "/" },
  ],
  nav: [
    { label: "Docs", href: "/get-started" },
    {
      label: "Examples",
      href: "https://github.com/vercel-labs/wterm/tree/main/examples",
      external: true,
    },
    {
      label: "npm",
      href: "https://www.npmjs.com/package/@wterm/core",
      external: true,
    },
  ],
  ai: { enabled: false },
  feedback: { enabled: false },
  language: { enabled: false },
  pageActions: { askAI: false, openInChat: false },
  webmcp: { enabled: true },
});
