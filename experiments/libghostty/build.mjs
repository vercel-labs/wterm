import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { release } from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const pin = JSON.parse(
  await readFile(new URL("upstream.json", import.meta.url)),
);
const dist = fileURLToPath(new URL("dist/", import.meta.url));
const zig = process.env.LIBGHOSTTY_ZIG || "zig";
const version = execFileSync(zig, ["version"], { encoding: "utf8" }).trim();
if (version !== pin.zigVersion)
  throw new Error(`Expected Zig ${pin.zigVersion}, got ${version}`);
await mkdir(dist, { recursive: true });
const archive = join(dist, `${pin.revision}.tar.gz`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let cached;
try {
  cached = await readFile(archive);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!cached || sha256(cached) !== pin.archiveSha256) {
  execFileSync(
    "curl",
    [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--output",
      archive,
      `https://codeload.github.com/ghostty-org/ghostty/tar.gz/${pin.revision}`,
    ],
    { stdio: "inherit" },
  );
}
if (sha256(await readFile(archive)) !== pin.archiveSha256)
  throw new Error("Upstream archive SHA-256 mismatch");

// Extract a fresh, verified source tree. Never patch upstream or use the shared
// Zig package cache used by the published @wterm/ghostty adapter.
const source = await mkdtemp(join(dist, "source-"));
try {
  execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", source], {
    stdio: "inherit",
  });
  const args = [
    "build",
    "-Demit-lib-vt",
    `-Dtarget=${pin.target}`,
    `-Doptimize=${pin.optimize}`,
    "--global-cache-dir",
    join(dist, "global-cache"),
    "--cache-dir",
    join(dist, "local-cache"),
  ];
  console.log(
    `Building upstream libghostty ${pin.revision} with Zig ${version}`,
  );
  execFileSync(zig, args, { cwd: source, stdio: "inherit" });
  const bytes = await readFile(join(source, "zig-out/bin/ghostty-vt.wasm"));
  await copyFile(
    join(source, "zig-out/bin/ghostty-vt.wasm"),
    join(dist, "ghostty-vt.wasm"),
  );
  const module = new WebAssembly.Module(bytes);
  const shipped = await readFile(
    new URL(
      "../../packages/@wterm/ghostty/wasm/ghostty-vt.wasm",
      import.meta.url,
    ),
  );
  const describe = (data) => ({
    bytes: data.length,
    gzipBytes: gzipSync(data).length,
    sha256: sha256(data),
  });
  await writeFile(
    join(dist, "build.json"),
    JSON.stringify(
      {
        upstream: pin,
        builtAt: new Date().toISOString(),
        buildEnvironment: {
          platform: process.platform,
          arch: process.arch,
          osRelease: release(),
          node: process.version,
          zlib: process.versions.zlib,
        },
        command: ["zig", ...args.slice(0, 4)],
        artifact: describe(bytes),
        shippedArtifact: describe(shipped),
        imports: WebAssembly.Module.imports(module),
        exportCount: WebAssembly.Module.exports(module).length,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Built ${bytes.length} bytes; metadata: ${join(dist, "build.json")}`,
  );
} finally {
  await rm(source, { recursive: true, force: true });
}
