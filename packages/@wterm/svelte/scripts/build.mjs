import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { force: true, recursive: true });
await mkdir("dist", { recursive: true });

await Promise.all([
  cp("src/lib/index.js", "dist/index.js"),
  cp("src/lib/index.d.ts", "dist/index.d.ts"),
  cp("src/lib/Terminal.svelte", "dist/Terminal.svelte"),
  cp("src/lib/Terminal.svelte.d.ts", "dist/Terminal.svelte.d.ts"),
]);

console.log("src/lib -> dist");
