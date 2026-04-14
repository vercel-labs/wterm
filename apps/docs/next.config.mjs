import createMDX from "@next/mdx";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["docs.wterm.localhost"],
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/just-bash", "@wterm/markdown", "@wterm/react"],
  serverExternalPackages: ["just-bash", "bash-tool"],
};

export default withMDX(nextConfig);
