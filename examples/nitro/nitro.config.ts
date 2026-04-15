import { defineConfig } from "nitro";

export default defineConfig({
  features: {
    websocket: true,
  },
  routes: {
    "/terminal": "./terminal.ts"
  }
});
