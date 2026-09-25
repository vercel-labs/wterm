# PTY and terminal replay harness

This workspace tests the built-in and Ghostty cores in Chromium, Firefox, and WebKit. Live `/bin/sh` sessions through `node-pty` and WebSocket exercise keyboard input, shell round trips, resize, and exit. Recorded Neovim/tmux sessions and explicit protocol fixtures exercise rendering and terminal state. Synthetic output workloads measure browser behavior under load. Server tests verify PTY cleanup and rejection of invalid requests.

## Setup

`read-text.spec.ts` checks stable text snapshots of unmounted history, cancellation, and selection/focus preservation for both cores.

Input accessibility cases cover named editable controls, readable mounted output, live ARIA label/description changes, tab-order ownership, Escape-then-Tab focus exit in both directions, cancellation, Kitty key ownership, hidden terminals, and teardown across all three browser engines.

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

The last two commands run server lifecycle tests and TypeScript checks. The normal repository test and type-check tasks also include this workspace; server lifecycle tests are skipped on Windows. The browser suite remains a separate `test:pty` task, which CI runs after the existing E2E suite. It covers live PTYs, recorded and protocol workloads, cursor appearance, background rendering, and cell alignment for both cores in all three browsers. Playwright WebKit coverage does not replace testing the Safari desktop application.

## Recorded workloads

Fixtures live in [`e2e/fixtures/`](../fixtures/README.md). The application captures include Neovim editing and tmux pane input, Unicode, two resizes, and exit/detach. Protocol fixtures check split UTF-8 and escape sequences, wide cells, ANSI styles, cursor reports, alternate-screen restoration, history, and synchronized output.

Replay opens `?mode=replay&core=builtin` or `?mode=replay&core=ghostty`, without starting a PTY. The browser receives raw byte arrays through `WTerm.write`: application output in chunks of at most seven bytes, protocol output one byte at a time. Captured timestamps document event order; CI skips the delays. Recorded inputs describe the original session and are never executed during replay. Each checkpoint compares explicit expected state with core cells and rendered DOM rows; selected styles are checked through computed CSS.

`cursor.spec.ts` checks application-controlled cursor shape, blink-off colors,
focus/visibility changes, and the host blink override. Add `cursorBlink=true`
or `cursorBlink=false` to the harness URL to exercise that override manually.

`background.spec.ts` samples rendered pixels to check edge-cell and scrollback
backgrounds, full-width status bars, partial redraws, screen changes, and resize.

`search.spec.ts` checks full-history Find, next/previous navigation, native
selection preservation, Unicode cell highlights, reflow, cancellation, and
synchronized-output refreshes. Replay exposes `search`, `searchState`,
`findNext`, `findPrevious`, and `clearSearch` on `window.ptyHarness`.

`copy.spec.ts` checks terminal selection text and clipboard-event handling,
including soft/hard line breaks, Unicode, block glyphs, whitespace, scrollback,
and synchronized output. `window.ptyHarness.selectionText()` reads the current
selection without writing the clipboard. Most tests use an isolated clipboard
event store; the native shortcut test copies a fixed sample and pastes it into
a separate input to verify the browser's actual clipboard payload.

Ghostty cases also preserve backward Unicode selections through narrower/wider reflow and distant output, check that gaps stay virtualized, and verify clearing on overwrites, resets, screen switches, and history pruning.

`select-all.spec.ts` checks full retained-history selection in both cores, bounded mounted rows while scrolling, real keyboard Copy/Paste, Unicode wraps, active-screen isolation, and cancellation. `window.ptyHarness.selectAll()` resolves when capture completes; `clearSelection()` cancels it.

`word-line-selection.spec.ts` exercises double/triple clicks, wrapped paths, Unicode cells, unmounted logical lines, reflow, native Copy/Paste, mouse-reporting ownership, and pending frames. The harness exposes `selectWord(position)` and `selectLine(row)` in retained-buffer coordinates.

`cell-width.spec.ts` checks column positions across ASCII, braille, box drawing,
wide characters, links, cursors, and scrollback. It also exercises font changes
and enlarged fallback glyphs without relying on a particular installed font.
Add `autoResize=true` to the harness URL to fit the grid to its container and
exercise column updates when font metrics change.

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

## Output-load measurements

From the repository root:

```bash
pnpm bench:terminal
WTERM_LOAD_PROFILE=stress pnpm bench:terminal --project chromium --repeat-each 3
```

The default `smoke` profile delivers 1 MiB per case; `stress` delivers 100 MiB.
Each profile runs plain-text scrolling, ANSI-colored scrolling, and full-screen
redraws for both cores in Chromium, Firefox, and WebKit. Targets round up to a
whole numbered line or frame. Each case gets a fresh browser context and terminal
at 80 × 24 cells. The runner serves an in-memory production bundle, with no Vite
development client or hot-reload connection. An untimed single-line write and two
animation callbacks warm the render path. Default adapter history settings are preserved; retained row
counts are reported because the cores have different retention policies.

The producer generates the same numbered records incrementally, retains only
one record and a 16 KiB write buffer, and submits one chunk per zero-delay timer
task. Browser timer clamping and all intervening work affect the delivered rate.
This is a fixed pacing policy, not a saturation-throughput or transport
backpressure test. It uses no PTY, network output, user input, or model calls.
Generation, timer scheduling, instrumentation, and periodic resource sampling
are included in elapsed time. Setup, workload hashing, and final assertions are
outside it. Two animation callbacks after the final write allow rendering to
settle. Hidden-page runs fail because background throttling changes the workload.

| Field | Boundary |
| --- | --- |
| `writeMs` | Each synchronous `WTerm.write` call, including core writes, responses, and scheduling |
| `coreWriteMs` | Nested `TerminalCore.writeRaw` call, including byte transfer, parsing, invalidation, and chunk callbacks; included in `writeMs` |
| `renderMs` | Each `Renderer.render` call, including core state extraction, DOM updates, and any layout it forces; excludes later WTerm scroll adjustments and browser paint |
| `frameIntervalMs` | Time between animation callback executions; a scheduling signal, not a dropped-frame count or presentation measurement |
| `taskDelayMs` | Lateness of a recurring 16 ms timer; a main-thread scheduling signal, not keyboard latency |
| `longTaskMs` | Browser Long Tasks entries during the measurement; `null` when unsupported, distinct from zero observed long tasks |
| `deliveredMiBPerSecond` | Submitted bytes divided by elapsed wall time, including the producer's timer pacing |
| `resources` | Samples before, every 64 chunks, and after the load: WASM linear-memory capacity, optional JS heap usage, terminal DOM element/row counts, and retained history rows |

Timing summaries contain count, retained count, mean, max, p50, p95, and p99.
Mean/max cover the complete run; percentiles use at most the latest 16,384 samples.
Stage durations overlap and must not be added together. The harness temporarily
wraps the core write and renderer methods and restores them even on failure;
published package code and APIs have no instrumentation changes. State extraction
and DOM work are currently combined in `renderMs`.

WASM capacity is read through benchmark-only adapter internals and is not live
allocation or process RSS. JS heap usage is available in Chromium with precise
memory reporting enabled; other browsers report `null`. It includes harness
allocations and follows ordinary garbage collection. Samples can miss transient
peaks and do not establish leak freedom or a process-memory cap. The DOM count
covers terminal elements, not text nodes or the browser's full DOM.

The suite asserts submitted byte/chunk counts, final numbered screen rows,
finite timing samples, and bounded mounted rows. It does not prove preservation
of every discarded history line. No speed or memory-size thresholds run on shared
CI. Tracing and video are disabled to reduce measurement overhead; failure
screenshots are taken after the measured work.

Per-case `load.json` attachments and a combined `e2e/test-results/load/load.json`
record success/failure, core, profile, repeat index, input SHA-256, source commit
and dirty status, both WASM hashes, browser version, host/CPU, viewport, font
stack, and cell geometry. Failed cases remain in the combined report; a missing
measurement is `null`. CI uploads this directory as `terminal-output-load`.

For comparisons, use the same profile, core, browser build, hardware, power mode,
font installation, and display settings, close unrelated workloads, and run
multiple repetitions. Keep per-run results rather than pooling samples across
machines. These reports do not compare wterm with desktop Ghostty or xterm.js,
measure startup/idle CPU, or certify input latency or multi-terminal behavior.

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
| `src/load-workloads.ts` | Numbered output streams, bounded chunk generation, and final row expectations |
| `src/load.ts` | Output-load timing, scheduling probes, and sampled resources |
| `load.html`, `src/load-main.ts` | Isolated browser page for automated load measurements |
| `load.config.ts`, `tests/load.bench.ts` | Separate load runner configuration and correctness assertions |
| `tests/load-reporter.ts` | Combined load measurements, provenance, and failed-case reports |
| `tests/terminal.spec.ts` | Real browser input, shell output, resize, exit, and report attachments |
| `tests/replay.spec.ts` | Byte-stream playback and semantic/DOM checkpoint assertions |
| `tests/baseline-reporter.ts` | Combined measurement and outcome report |
| `record-apps.mjs` | Isolated Neovim and tmux capture with explicit checkpoints |
| `tests/server.test.mjs` | Real-process lifecycle and protocol boundary checks |
| `playwright.config.ts` | Chromium, Firefox, and WebKit projects and artifact settings |

The output-announcement browser cases cover both cores: opt-in behavior,
Unicode/ANSI text, focus gating, new scrollback, flood limits, repeated results,
synchronized output, and teardown. `ptyHarness.setOutputAnnouncements(enabled)`
controls the same WTerm API used by hosts.
