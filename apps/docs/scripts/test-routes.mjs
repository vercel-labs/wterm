import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const socket = createServer();
await new Promise((resolve, reject) => {
  socket.once("error", reject);
  socket.listen(0, "localhost", resolve);
});
const port = socket.address().port;
await new Promise((resolve, reject) =>
  socket.close((error) => (error ? reject(error) : resolve())),
);

const server = Bun.spawn(
  [
    "node",
    fileURLToPath(import.meta.resolve("next/dist/bin/next")),
    "start",
    "--hostname",
    "localhost",
    "--port",
    String(port),
  ],
  {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  },
);
const url = `http://localhost:${port}`;
let tests;
let shutdown;
const stop = () => {
  shutdown ??= Promise.all(
    [tests, server].map(async (child) => {
      if (!child || child.exitCode !== null) return;
      child.kill("SIGTERM");
      const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        await child.exited;
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
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Docs server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`${url}/robots.txt`, {
        signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(100);
  }
  if (!ready)
    throw new Error(
      "Docs server did not become ready. Run the docs build first.",
    );
  tests = Bun.spawn([process.execPath, "test", "tests/docs-routes.test.mjs"], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, DOCS_TEST_URL: url },
  });
  process.exitCode = await tests.exited;
} finally {
  await stop();
}
