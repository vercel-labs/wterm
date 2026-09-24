import { chmod, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// node-pty ships macOS prebuilds, but its published spawn-helper can lose
// executable permissions during installation. Linux uses the native build.
if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const helper = join(
    dirname(require.resolve("node-pty/package.json")),
    "prebuilds",
    `darwin-${process.arch}`,
    "spawn-helper",
  );
  const info = await stat(helper);
  await chmod(helper, (info.mode & 0o777) | 0o111);
}
