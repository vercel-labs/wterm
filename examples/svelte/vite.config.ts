import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { ptyServer } from "./vite-plugins/pty-server.js";

export default defineConfig({
  plugins: [svelte(), tailwindcss(), ptyServer()],
  server: {
    allowedHosts: ["svelte-example.wterm.localhost"],
  },
});
