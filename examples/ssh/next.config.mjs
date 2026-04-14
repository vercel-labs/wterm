/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["ssh-example.wterm.localhost"],
  transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/react"],
  serverExternalPackages: ["ssh2"],
};

export default nextConfig;
