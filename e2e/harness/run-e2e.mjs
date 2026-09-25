import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHarnessServer } from "./server.mjs";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const load = args[0] === "--load";
if (load) args.shift();
const harness = await createHarnessServer({ load });
let child;
let interrupted;
let killTimer;
const onSignal = (signal) => {
  interrupted = signal;
  child?.kill(signal);
  killTimer ??= setTimeout(() => child?.kill("SIGKILL"), 3000);
  killTimer.unref();
};
const onInterrupt = () => onSignal("SIGINT");
const onTerminate = () => onSignal("SIGTERM");
process.once("SIGINT", onInterrupt);
process.once("SIGTERM", onTerminate);
try {
  child = spawn(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      fileURLToPath(
        new URL(
          load ? "load.config.ts" : "playwright.config.ts",
          import.meta.url,
        ),
      ),
      ...args,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, WTERM_PTY_URL: harness.url },
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? (interrupted ? 130 : 1)));
  });
} finally {
  clearTimeout(killTimer);
  await harness.close();
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onTerminate);
}
