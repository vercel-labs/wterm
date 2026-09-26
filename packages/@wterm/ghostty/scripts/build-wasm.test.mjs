import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Exercise the build driver's failure and ownership boundaries without a
// network or compiler. CI separately rebuilds the real pinned dependency.
function fixture(t) {
  const root = mkdtempSync("/tmp/wterm-ghostty-script-test-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "zig", "wasm", "shared-cache"])
    mkdirSync(join(root, dir));
  for (const name of ["build-wasm.sh", "zig-toolchain.sh"])
    copyFileSync(new URL(name, import.meta.url), join(root, "scripts", name));
  writeFileSync(
    join(root, "zig/build.zig.zon"),
    '.{ .dependencies = .{ .ghostty = .{ .url = "https://example.invalid/ghostty.tar.gz", .hash = "ghostty-fixture-hash" }, }, }',
  );
  writeFileSync(
    join(root, "shared-cache/sentinel"),
    "leave shared caches alone",
  );
  writeFileSync(join(root, "wasm/ghostty-vt.wasm"), "committed artifact");
  writeFileSync(
    join(root, "scripts/patch-ghostty-wasm.sh"),
    '#!/bin/bash\nset -eu\nif [[ "${WTERM_TEST_UNSTABLE_PATCH:-}" == 1 ]]; then echo patch >> "$1/patched"; else echo patch > "$1/patched"; fi\n',
  );
  const fakeZig = join(root, "fake zig.mjs");
  writeFileSync(
    fakeZig,
    `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
fs.appendFileSync(process.env.WTERM_TEST_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'version') {
  console.log(process.env.WTERM_TEST_VERSION || '0.15.2');
} else if (args[0] === 'fetch') {
  const cache = option('--global-cache-dir');
  fs.mkdirSync(path.join(cache, 'p/ghostty-fixture-hash'), { recursive: true });
  console.log(process.env.WTERM_TEST_HASH || 'ghostty-fixture-hash');
} else if (args[0] === 'build') {
  if (process.env.WTERM_TEST_BUILD_FAIL) process.exit(2);
  const output = path.join(option('--prefix'), 'bin');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'ghostty-vt.wasm'), process.env.WTERM_TEST_ARTIFACT || 'committed artifact');
} else { throw new Error('Unexpected compiler invocation'); }
`,
    { mode: 0o755 },
  );
  const log = join(root, "commands.jsonl");
  const run = (args = [], env = {}) =>
    spawnSync("bash", [join(root, "scripts/build-wasm.sh"), ...args], {
      cwd: root,
      env: {
        ...process.env,
        WTERM_GHOSTTY_ZIG: fakeZig,
        WTERM_TEST_LOG: log,
        ZIG_GLOBAL_CACHE_DIR: join(root, "shared-cache"),
        ZIG_LOCAL_CACHE_DIR: join(root, "shared-cache"),
        ...env,
      },
      encoding: "utf8",
    });
  const commands = () =>
    existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse)
      : [];
  const artifact = () =>
    readFileSync(join(root, "wasm/ghostty-vt.wasm"), "utf8");
  const checkCleanup = () => {
    const fetch = commands().find((args) => args[0] === "fetch");
    if (fetch) {
      const cache = fetch[fetch.indexOf("--global-cache-dir") + 1];
      assert.match(cache, /^\/tmp\/wterm-ghostty-build\./);
      assert.equal(
        existsSync(cache),
        false,
        "owned cache must be removed on success and failure",
      );
    }
    assert.equal(
      readFileSync(join(root, "shared-cache/sentinel"), "utf8"),
      "leave shared caches alone",
    );
    assert.equal(existsSync(join(root, "zig/.zig-cache")), false);
    assert.equal(existsSync(join(root, "zig/zig-out")), false);
  };
  return { root, run, commands, artifact, checkCleanup };
}

test("check mode builds in isolation, leaves the artifact alone, and removes its cache", (t) => {
  const f = fixture(t);
  const result = f.run(["--check"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(f.artifact(), "committed artifact");
  assert.match(result.stdout, /matches the committed artifact byte for byte/);
  f.checkCleanup();
});

test("artifact drift fails without overwriting the committed binary", (t) => {
  const f = fixture(t);
  const result = f.run(["--check"], { WTERM_TEST_ARTIFACT: "different build" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /does not match/);
  assert.equal(f.artifact(), "committed artifact");
  f.checkCleanup();
});

test("rebuild mode replaces the binary only after a successful build", (t) => {
  const f = fixture(t);
  const result = f.run([], { WTERM_TEST_ARTIFACT: "new build" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.artifact(), "new build");
  f.checkCleanup();
});

test("a compiler failure preserves the binary and cleans temporary files", (t) => {
  const f = fixture(t);
  const result = f.run([], { WTERM_TEST_BUILD_FAIL: "1" });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(f.artifact(), "committed artifact");
  f.checkCleanup();
});

test("a wrong compiler version fails before fetching dependencies", (t) => {
  const f = fixture(t);
  const result = f.run(["--check"], { WTERM_TEST_VERSION: "0.15.1" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Expected Zig 0.15.2, got 0.15.1/);
  assert.deepEqual(f.commands(), [["version"]]);
  assert.equal(f.artifact(), "committed artifact");
});

test("a dependency hash mismatch fails before patching or compiling", (t) => {
  const f = fixture(t);
  const result = f.run(["--check"], { WTERM_TEST_HASH: "wrong-source" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /dependency hash mismatch/);
  assert.equal(
    f.commands().some((args) => args[0] === "build"),
    false,
  );
  assert.equal(f.artifact(), "committed artifact");
  f.checkCleanup();
});

test("patches that change on their second application fail before compiling", (t) => {
  const f = fixture(t);
  const result = f.run(["--check"], { WTERM_TEST_UNSTABLE_PATCH: "1" });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(
    f.commands().some((args) => args[0] === "build"),
    false,
  );
  assert.equal(f.artifact(), "committed artifact");
  f.checkCleanup();
});

test("unknown options fail before invoking a compiler", (t) => {
  const f = fixture(t);
  const result = f.run(["--unknown"]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Usage:/);
  assert.deepEqual(f.commands(), []);
});

test("separate invocations cannot reuse patched dependency or compiler caches", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 2; i++) {
    const result = f.run(["--check"]);
    assert.equal(result.status, 0, result.stderr);
  }
  const caches = f
    .commands()
    .filter((args) => args[0] === "fetch")
    .map((args) => args[args.indexOf("--global-cache-dir") + 1]);
  assert.equal(new Set(caches).size, 2);
  for (const cache of caches) assert.equal(existsSync(cache), false);
  f.checkCleanup();
});
