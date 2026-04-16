export type NavItem = {
  name: string;
  href: string;
  external?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

const GITHUB = "https://github.com/vercel-labs/wterm";

export const navGroups: NavGroup[] = [
  {
    label: "Documentation",
    items: [
      { name: "Introduction", href: "/" },
      { name: "Get Started", href: "/get-started" },
      { name: "Configuration", href: "/configuration" },
      { name: "Themes", href: "/themes" },
      { name: "API Reference", href: "/api-reference" },
    ],
  },
  {
    label: "Frameworks",
    items: [
      { name: "React", href: "/react" },
      { name: "Vanilla JS", href: "/vanilla" },
    ],
  },
  {
    label: "Packages",
    items: [
      { name: "Just Bash", href: "/just-bash" },
      { name: "Markdown", href: "/markdown" },
      { name: "Core / Advanced", href: "/core" },
    ],
  },
  {
    label: "Examples",
    items: [
      {
        name: "Next.js",
        href: `${GITHUB}/tree/main/examples/nextjs`,
        external: true,
      },
      {
        name: "SSH Client",
        href: `${GITHUB}/tree/main/examples/ssh`,
        external: true,
      },
      {
        name: "Local Shell",
        href: `${GITHUB}/tree/main/examples/local`,
        external: true,
      },
      {
        name: "Vite",
        href: `${GITHUB}/tree/main/examples/vite`,
        external: true,
      },
      {
        name: "Markdown Streaming",
        href: `${GITHUB}/tree/main/examples/markdown-streaming`,
        external: true,
      },
    ],
  },
  {
    label: "Source",
    items: [
      {
        name: "@wterm/core",
        href: `${GITHUB}/tree/main/packages/@wterm/core`,
        external: true,
      },
      {
        name: "@wterm/dom",
        href: `${GITHUB}/tree/main/packages/@wterm/dom`,
        external: true,
      },
      {
        name: "@wterm/react",
        href: `${GITHUB}/tree/main/packages/@wterm/react`,
        external: true,
      },
      {
        name: "@wterm/just-bash",
        href: `${GITHUB}/tree/main/packages/@wterm/just-bash`,
        external: true,
      },
      {
        name: "@wterm/markdown",
        href: `${GITHUB}/tree/main/packages/@wterm/markdown`,
        external: true,
      },
    ],
  },
];

export const allDocsPages: NavItem[] = navGroups
  .flatMap((g) => g.items)
  .filter((item) => !item.external);
