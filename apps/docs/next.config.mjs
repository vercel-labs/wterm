import { createGeistdocs } from "@vercel/geistdocs/next";

const withMDX = createGeistdocs();

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["docs.wterm.localhost"],
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  transpilePackages: [
    "@wterm/core",
    "@wterm/dom",
    "@wterm/just-bash",
    "@wterm/markdown",
    "@wterm/react",
  ],
  serverExternalPackages: ["just-bash", "bash-tool"],
  async redirects() {
    return [
      {
        source: "/introduction",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default withMDX(nextConfig);
