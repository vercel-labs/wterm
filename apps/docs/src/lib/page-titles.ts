export const PAGE_TITLES: Record<string, string> = {
  "": "Terminal Emulator\nfor the Web",
  introduction: "Introduction",
  "get-started": "Get Started",
  configuration: "Configuration",
  themes: "Themes",
  react: "React",
  vanilla: "Vanilla JS",
  "just-bash": "Just Bash",
  markdown: "Markdown",
  core: "Core / Advanced",
  "api-reference": "API Reference",
};

export function getPageTitle(slug: string): string | null {
  return slug in PAGE_TITLES ? PAGE_TITLES[slug]! : null;
}
