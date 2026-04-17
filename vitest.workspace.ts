import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/@wterm/markdown",
  "packages/@wterm/core",
  "packages/@wterm/dom",
  "packages/@wterm/react",
  "packages/@wterm/vue",
  "packages/@wterm/svelte",
  "packages/@wterm/just-bash",
]);
