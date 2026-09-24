# Real PTY baseline harness

This workspace connects the built-in and Ghostty cores to real `/bin/sh` processes through `node-pty` and WebSocket. Chromium smoke tests exercise keyboard input, escape-sequence rendering, a shell round trip, terminal resize, and process exit. Server tests verify PTY cleanup and rejection of invalid requests.

## Setup

Requires macOS or Linux, Node.js 24+, pnpm 11+, and a C++/Python build toolchain on Linux for `node-pty`. On macOS the package uses prebuilt binaries; the preparation script restores the published spawn helper's executable bit. The workspace allows `node-pty`'s native install scripts so clean Linux installs build the binding.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:pty
```

`pnpm test:pty` builds the terminal packages, starts an owned loopback server on an OS-assigned port, passes its URL to Playwright, and closes the server and PTYs on completion, test failure, or SIGINT/SIGTERM. It does not reuse an existing server or require Portless in CI. Pass Playwright arguments to the workspace runner after building, for example:

```bash
pnpm --filter @internal/pty-harness test:e2e --grep ghostty
pnpm --filter @internal/pty-harness test
pnpm --filter @internal/pty-harness type-check
```

The last two commands run server lifecycle tests and TypeScript checks. The normal repository test and type-check tasks also include this workspace; server lifecycle tests are skipped on Windows. Browser smoke tests remain a separate `test:pty` task, which CI runs after the existing E2E suite.

## Interactive use

Install Portless globally (`npm i -g portless`), then run:

```bash
pnpm exec turbo run build --filter='@internal/pty-harness^...'
pnpm --filter @internal/pty-harness dev
```

Open the URL Portless prints for `pty-harness.wterm.localhost`. Choose Built-in or Ghostty; switching cores or choosing **New session** starts a fresh PTY. Type commands into the terminal. At an empty shell prompt, **Run round trip** executes `printf` with a unique marker and records a timing sample. **Download report** exports the current counters, timing summaries, terminal dimensions, browser environment, and server platform/toolchain metadata.

Each connection runs `/bin/sh -i` with a controlled environment and prompt, in its own temporary working directory. Shell startup files are not loaded. Working directories are removed when the harness stops. The server binds to `127.0.0.1` and accepts only its exact HTTP Host and WebSocket Origin, including the URL supplied by Portless. It is a local development/test harness, not a deployed session service. Disconnect destroys the shell.

## What the measurements mean

The harness instruments its own call sites and leaves the terminal packages' runtime APIs unchanged. Debug escape-sequence tracing is disabled.

| Field | Measurement |
| --- | --- |
| `outputBytes` | UTF-8 bytes of decoded PTY output received by this page |
| `writeMs` | Synchronous duration of `WTerm.write`, including parsing, response handling, and scheduling; excludes the later DOM render |
| `receiveToFrameMs` | First output receipt in a batch to the next animation callback scheduled after the terminal write; one sample per pending callback |
| `roundTripToFrameMs` | Sending the probe command to the animation callback after its assembled marker returns through the PTY |

The probe's complete marker does not occur in the command text, so PTY input echo cannot satisfy the measurement. The automated keyboard test also assembles its expected output inside the shell and asserts that stdin/stdout are TTYs.

All timing values are milliseconds on the browser's monotonic clock. Mean/max/count cover the page's lifetime; percentiles cover the latest 512 samples, with `retained` reporting that window's size. There is at most one pending instrumentation frame. The callback is a frame opportunity, **not a measurement of physical presentation**; synchronized output and background throttling can further separate callbacks from visible updates. Round-trip probes require an idle prompt and are not keyboard-to-pixel latency measurements.

## Results and troubleshooting

Playwright writes to `e2e/test-results/pty/`. Every browser test attaches `pty-baseline.json`; failures also retain a trace and screenshot. CI uploads that directory as `pty-baseline`, including failed runs. Reports identify the selected core, browser version, terminal dimensions, OS, CPU, Node, node-pty, shell, and TERM setting. Test artifacts are ignored by Git.

If a native binding is missing, install the platform build prerequisites and run `pnpm rebuild node-pty`. If Chromium is missing, run the browser installation command above (CI uses `--with-deps`). Invalid dimensions, malformed messages, and binary WebSocket input close the connection. Messages are capped at 64 KiB and the harness aborts a connection whose pending WebSocket output exceeds 1 MiB.

## Key files

| File | Purpose |
| --- | --- |
| `server.mjs` | Vite middleware, loopback HTTP/WebSocket endpoint, controlled shell spawning, and cleanup |
| `run-e2e.mjs` | Owns the server and Playwright process, including signal handling |
| `prepare-pty.mjs` | Makes the macOS prebuilt spawn helper executable |
| `src/main.ts` | Both core paths, interactive controls, snapshots, and timing probes |
| `src/metrics.ts` | Bounded samples and timing summaries |
| `tests/terminal.spec.ts` | Real browser input, shell output, resize, exit, and report attachments |
| `tests/server.test.mjs` | Real-process lifecycle and protocol boundary checks |
| `playwright.config.ts` | Isolated Chromium smoke suite and artifact settings |
