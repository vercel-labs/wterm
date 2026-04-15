/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["local-example.wterm.localhost"],
  transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/react"],
  serverExternalPackages: ["zigpty"],
};

export default nextConfig;
