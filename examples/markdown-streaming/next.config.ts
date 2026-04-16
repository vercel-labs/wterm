import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["markdown-streaming-example.wterm.localhost"],
  transpilePackages: [
    "@wterm/core",
    "@wterm/dom",
    "@wterm/markdown",
    "@wterm/react",
  ],
};

export default nextConfig;
