/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["nextjs-example.wterm.localhost"],
  transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/just-bash", "@wterm/react"],
};

export default nextConfig;
