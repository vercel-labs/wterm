# PTY and terminal replay harness

This workspace tests the built-in and Ghostty cores in Chromium, Firefox, and WebKit. Live `/bin/sh` sessions through `node-pty` and WebSocket exercise keyboard input, shell round trips, resize, and exit. Recorded Neovim/tmux sessions and explicit protocol fixtures exercise rendering and terminal state. Server tests verify PTY cleanup and rejection of invalid requests.

## Setup

Requires macOS or Linux, Node.js 24+, pnpm 11+, and a C++/Python build toolchain on Linux for `node-pty`. On macOS the package uses prebuilt binaries; the preparation script restores the published spawn helper's executable bit. The workspace allows `node-pty`'s native install scripts so clean Linux installs build the binding.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox webkit
pnpm test:pty
```

`pnpm test:pty` builds the terminal packages, starts an owned loopback server on an OS-assigned port, passes its URL to Playwright, and closes the server and PTYs on completion, test failure, or SIGINT/SIGTERM. It does not reuse an existing server or require Portless in CI. Pass Playwright arguments to the workspace runner after building, for example:

```bash
pnpm --filter @internal/pty-harness test:e2e --grep ghostty
pnpm --filter @internal/pty-harness test:e2e --project firefox
pnpm --filter @internal/pty-harness test:e2e replay.spec.ts
pnpm --filter @internal/pty-harness test
pnpm --filter @internal/pty-harness type-check
```

The last two commands run server lifecycle tests and TypeScript checks. The normal repository test and type-check tasks also include this workspace; server lifecycle tests are skipped on Windows. The browser suite remains a separate `test:pty` task, which CI runs after the existing E2E suite. It has 48 cases: three live-PTY cases and five replay workloads for each of two cores in three browsers. Playwright WebKit coverage does not replace testing the Safari desktop application.

## Recorded workloads

Fixtures live in [`e2e/fixtures/`](../fixtures/README.md). The application captures include Neovim editing and tmux pane input, Unicode, two resizes, and exit/detach. Protocol fixtures check split UTF-8 and escape sequences, wide cells, ANSI styles, cursor reports, alternate-screen restoration, history, and synchronized output.

Replay opens `?mode=replay&core=builtin` or `?mode=replay&core=ghostty`, without starting a PTY. The browser receives raw byte arrays through `WTerm.write`: application output in chunks of at most seven bytes, protocol output one byte at a time. Captured timestamps document event order; CI skips the delays. Recorded inputs describe the original session and are never executed during replay. Each checkpoint compares explicit expected state with core cells and rendered DOM rows; selected styles are checked through computed CSS.

To regenerate the application recordings, install `nvim`, `tmux`, and `infocmp` on macOS or Linux, then run:

```bash
pnpm --filter @internal/pty-harness record
pnpm test:pty
```

The recorder uses generated files, isolated configuration, and a private tmux socket. Review byte-stream and metadata changes before committing refreshed fixtures. Expectations are authored from the application actions and protocol semantics; the recorder does not derive expected screens from wterm.

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
| `outputBytes` | UTF-8 bytes of decoded live PTY output, or exact raw bytes supplied by a replay |
| `writeMs` | Synchronous duration of `WTerm.write`, including parsing, response handling, and scheduling; excludes the later DOM render |
| `receiveToFrameMs` | First output receipt in a batch to the next animation callback scheduled after the terminal write; one sample per pending callback |
| `roundTripToFrameMs` | Sending the probe command to the animation callback after its assembled marker returns through the PTY |

The probe's complete marker does not occur in the command text, so PTY input echo cannot satisfy the measurement. The automated keyboard test also assembles its expected output inside the shell and asserts that stdin/stdout are TTYs.

Reports distinguish `source: "pty"` from `source: "replay"`. Replay write samples reflect the declared chunk size and omit PTY, network, and application execution time. Its receive-to-frame interval starts when bytes are supplied to the browser. These samples are useful for repeatable workload comparisons, not desktop latency comparisons; replay round-trip counters stay at zero.

All timing values are milliseconds on the browser's monotonic clock. Mean/max/count cover the page's lifetime; percentiles cover the latest 512 samples, with `retained` reporting that window's size. There is at most one pending instrumentation frame. The callback is a frame opportunity, **not a measurement of physical presentation**; synchronized output and background throttling can further separate callbacks from visible updates. Round-trip probes require an idle prompt and are not keyboard-to-pixel latency measurements.

## Results and troubleshooting

Playwright writes to `e2e/test-results/pty/`. Live tests attach `pty-baseline.json`; replay tests attach `replay-baseline.json` with expected and actual checkpoints, fixture hash, capture provenance, and chunk size. The reporter writes a compact `baseline.json` for the complete run, including unsuccessful tests. Failure traces and screenshots are retained. CI uploads the directory as `pty-baseline`, including failed runs. Reports identify the selected core, browser/project version, terminal dimensions, OS, CPU, Node, node-pty, shell, and TERM setting. Test artifacts are ignored by Git.

If a native binding is missing, install the platform build prerequisites and run `pnpm rebuild node-pty`. If a browser is missing, run the browser installation command above (CI uses `--with-deps`). Invalid dimensions, malformed messages, and binary WebSocket input close the connection. Messages are capped at 64 KiB and the harness aborts a connection whose pending WebSocket output exceeds 1 MiB.

## Key files

| File | Purpose |
| --- | --- |
| `server.mjs` | Vite middleware, loopback HTTP/WebSocket endpoint, controlled shell spawning, and cleanup |
| `run-e2e.mjs` | Owns the server and Playwright process, including signal handling |
| `prepare-pty.mjs` | Makes the macOS prebuilt spawn helper executable |
| `src/main.ts` | Both core paths, interactive controls, snapshots, and timing probes |
| `src/metrics.ts` | Bounded samples and timing summaries |
| `tests/terminal.spec.ts` | Real browser input, shell output, resize, exit, and report attachments |
| `tests/replay.spec.ts` | Byte-stream playback and semantic/DOM checkpoint assertions |
| `tests/baseline-reporter.ts` | Combined measurement and outcome report |
| `record-apps.mjs` | Isolated Neovim and tmux capture with explicit checkpoints |
| `tests/server.test.mjs` | Real-process lifecycle and protocol boundary checks |
| `playwright.config.ts` | Chromium, Firefox, and WebKit projects and artifact settings |
