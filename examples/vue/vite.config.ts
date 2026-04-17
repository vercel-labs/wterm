import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { ptyServer } from "./vite-plugins/pty-server.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss(), ptyServer()],
  server: {
    allowedHosts: ["vue-example.wterm.localhost"],
  },
});
