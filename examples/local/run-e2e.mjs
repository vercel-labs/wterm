import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("./", import.meta.url));
const socket = createServer();
await new Promise((resolve, reject) => {
  socket.once("error", reject);
  socket.listen(0, "localhost", resolve);
});
const port = socket.address().port;
await new Promise((resolve, reject) =>
  socket.close((error) => (error ? reject(error) : resolve())),
);

function launch(args, env) {
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit", env });
  const result = { child, done: false, exited: undefined };
  result.exited = new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(error.message);
      result.done = true;
      resolve(1);
    });
    child.once("exit", (code) => {
      result.done = true;
      resolve(code ?? 1);
    });
  });
  return result;
}

const server = launch(
  [
    fileURLToPath(import.meta.resolve("next/dist/bin/next")),
    "start",
    "--hostname",
    "localhost",
  ],
  { ...process.env, NODE_ENV: "production", PORT: String(port) },
);
const url = `http://localhost:${port}`;
let tests;
let shutdown;
let stopping = false;
const stop = () => {
  stopping = true;
  shutdown ??= Promise.all(
    [tests, server].map(async (process) => {
      if (!process || process.done) return;
      process.child.kill("SIGTERM");
      const deadline = setTimeout(() => process.child.kill("SIGKILL"), 5000);
      try {
        await process.exited;
      } finally {
        clearTimeout(deadline);
      }
    }),
  );
  return shutdown;
};
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(code));
  });
}

try {
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline && !stopping) {
    if (server.done)
      throw new Error(
        `Local workspace server exited with ${await server.exited}`,
      );
    try {
      const response = await fetch(`${url}/`, {
        signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await sleep(100);
  }
  if (!ready && !stopping)
    throw new Error(
      "Local workspace server did not become ready. Run the local workspace build first.",
    );
  if (!stopping) {
    const args = [
      fileURLToPath(import.meta.resolve("@playwright/test/cli")),
      "test",
      "--config",
      "tests/playwright.config.ts",
      ...process.argv.slice(2),
    ];
    tests = launch(args, {
      ...process.env,
      LOCAL_TEST_URL: url,
    });
    process.exitCode = await tests.exited;
  }
} finally {
  await stop();
}
