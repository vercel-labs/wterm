# PTY and terminal replay harness

This workspace tests the built-in and Ghostty cores in Chromium, Firefox, and WebKit. Live `/bin/sh` sessions through `node-pty` and WebSocket exercise keyboard input, shell round trips, resize, and exit. Recorded Neovim/tmux sessions and explicit protocol fixtures exercise rendering and terminal state. Synthetic output workloads measure browser behavior under load. Server tests verify PTY cleanup and rejection of invalid requests.

## Setup

`read-text.spec.ts` checks stable text snapshots of unmounted history, cancellation, and selection/focus preservation for both cores.

Input accessibility cases cover named editable controls, readable mounted output, live ARIA label/description changes, tab-order ownership, Escape-then-Tab focus exit in both directions, cancellation, Kitty key ownership, hidden terminals, and teardown across all three browser engines.

Rendering-pause cases verify that inactive panes keep parsing terminal replies,
titles, bells, history, screen switches, and resizes while their DOM stays
unchanged. Resuming respects synchronized drawing and paints the latest state.

Pixel-query cases check viewport and cell-size replies split across byte writes,
alongside fragmented Unicode and ANSI output, including while painting is paused.

`scrollback-reuse.spec.ts` checks that scrolling only constructs DOM for entering
history rows and incoming output leaves unchanged history DOM intact. Both
cores retain native selections, Unicode copy text, links, and row backgrounds
across those updates in all three browser engines.
It also checks that clear/refill and Ghostty OSC palette updates refresh mounted
history even when the retained row count is unchanged.

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

`underline.spec.ts` checks Ghostty's five underline variants, independent
underline colors and strikethrough, SGR resets, Unicode cell geometry, links,
selection, history, and resize. It also covers flag-based single underlines
with the built-in core.

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

`rectangle-selection.spec.ts` checks Alt/Option-drag, Unicode edge highlights, native Copy/Paste, unmounted history, bounded edge scrolling, application mouse ownership, and cancellation during output or focus changes. The harness exposes `selectRectangle(start, end)` with inclusive retained-row/cell corners.

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

## Sustained output and resource checks

```bash
pnpm bench:stability
WTERM_STABILITY_PROFILE=soak pnpm bench:stability --project chromium --grep 'ghostty sustained output'
```

This suite checks sustained ANSI-colored scrolling at 80 × 24 cells. Each
zero-delay timer task writes 16 numbered ASCII rows with changing fingerprints.
Every parsed row is compared with its expected text before another batch can
discard it. Each renderer update checks the latest batch's DOM text separately;
coalesced intermediate batches need not paint. This checks text ordering and
preservation, not color/style fidelity. The final batch must render, followed by
two animation callbacks, before a run can complete.

Both engines warm up with at least 1 MiB of output, history pruning, and a checked
render. Ghostty uses a 64 KiB history budget; the built-in engine keeps its default
history setting. The `smoke` profile then writes for at least three seconds and
128 KiB. The `soak` profile writes for at least 30 minutes and 100 MiB. Each run has
a 2 GiB output limit and a deadline two minutes beyond the profile duration.
Warmup must finish within 30 seconds. Each case uses a fresh page and production
bundle, with no PTY, output transport, graphics, resize, or user input.

Resource samples record WASM capacity, optional Chromium JS heap usage, terminal
DOM elements and mounted rows, retained history, and discarded rows. Sampling
runs before output, at the measurement boundary, every second (`smoke`) or ten
seconds (`soak`), and at completion or failure, retaining at most 2,000 samples.
WASM capacity must stay at its post-warmup size and mounted rows must stay below
200. Samples that exceed these bounds remain in failed reports. JS heap includes
workload generation, assertions, reporting, and ordinary garbage collection; it
has no pass/fail threshold. These observations do not measure process RSS,
establish a full memory cap, or prove leak freedom.

`frameIntervals` measures time between animation callbacks. `taskDelays` measures
time from scheduling a zero-delay output task to its execution, including timer
clamping. Both cover only the measured phase: means/maxima cover all samples,
while percentiles retain at most the latest 4,096. Generation, row assertions,
resource checks, and host report polling affect the workload. A five-second gap
between checked renders fails the run; this is a hang check, not a responsiveness
budget or physical presentation measurement.

Cancellation, hidden pages, navigation, and browser errors stop the producer and
restore instrumentation. Failure controls exercise cancellation, lost output,
paused rendering, and excess mounted rows. Per-case and combined `stability.json`
reports under `e2e/test-results/stability/` include source/workload/WASM hashes,
host/browser/font metadata, verified row/frame counts, and bounded resource
samples. The host retains the last polled report if the page fails. A hung or
crashed browser may leave only a partial or missing measurement; the case still
fails. Long runs print progress approximately once a minute. CI runs the short
profile across Chromium, Firefox, and WebKit and uploads `terminal-stability`.

For long-run comparisons, keep the browser, machine, power mode, font installation,
and profile fixed; close unrelated workloads and preserve individual reports.
Passing this suite alone does not certify input latency, transport queues,
graphics retention, all terminal protocols, or desktop Ghostty parity.

## Input responsiveness measurements

```bash
pnpm bench:input
WTERM_INPUT_PROFILE=measure pnpm bench:input --project chromium --repeat-each 3
```

This separate suite sends trusted keyboard events through Playwright and echoes
them synchronously through the terminal's `onData`/`write` path. Both cores run
idle, ANSI scrolling, and screen redraw workloads with one or eight independent
80 × 24 terminals in Chromium, Firefox, and WebKit. Only the first terminal is
visible and focused; the others are inert, CSS-hidden, and rendering-paused while
continuing to parse output. Row 1 is reserved for echo, with output restricted to
rows 2–24. The partial scroll region keeps this workload out of retained history;
use the output-load suite to exercise history growth.

Each non-idle session has an independent zero-delay timer submitting one complete
chunk of at most 16 KiB per task. The producer cycles over 32 precomputed chunks;
records never split escape sequences that could consume an interleaved echo.
Generation, font loading, initialization, a warmup write, and two frame callbacks
precede measurement. Producer scheduling, instrumentation, and automation pacing
affect elapsed time and delivered throughput. This is a declared bounded producer
policy, not a fixed output rate or a saturation benchmark.

A capture-phase `keydown` listener timestamps each trusted lowercase key before
WTerm handles it. The echo contains a unique sequence marker. A MutationObserver
records when that exact marker reaches the first live DOM row, then schedules an
animation callback which verifies the marker is still present before counting a
completed sample. Arbitrary frame callbacks cannot satisfy a missing DOM echo.
The first key waits until every producer has submitted output. Probes are serial:
the driver waits for completion before sending another key.
Automation round trips and completion time determine the typing rate. The default
`smoke` profile uses 16 keys per case; `measure` uses 256. Percentiles over 16 keys
are smoke data only, and even 256 samples offer limited evidence about the tail.

| Field | Boundary |
| --- | --- |
| `keyDispatchToDOMMs` | Capture-phase browser key dispatch to observation of the matching echo in DOM |
| `keyDispatchToFrameMs` | Same dispatch to a subsequent animation callback after that DOM observation |
| `sessions[].writeMs` | Synchronous background-output writes, excluding echo writes |
| `sessions[].renderMs` | Renderer calls during measurement, including echo rendering; inactive sessions must have zero calls |
| `sessions[].deliveredMiBPerSecond` | Actual submitted background bytes per elapsed wall time, separately for every session |
| `resources` | Before/after WASM capacity, optional JS heap, mounted rows, DOM elements, and retained history counts |

Timings include observer and harness overhead. They exclude OS/driver delivery,
time waiting in the browser's input queue **before dispatch**, PTY/network delay,
and physical display presentation. A frame callback is an opportunity to paint;
it does not establish when pixels were displayed. These measurements cannot
certify end-to-end key-to-pixel latency or compare with desktop Ghostty.
Resource snapshots have the same capacity, heap, and sampling limitations as
the output-load suite. Echo summaries retain all samples (up to 1,024); write and
render percentiles retain the latest 8,192 samples, with whole-run mean/max/count.

The suite asserts every expected echo, finite timing values, output byte counts,
final parsed batch markers in every session, bounded mounted rows, and no hidden
renderer calls. Lost focus, hidden pages, overlapping/unexpected input, missing
echoes after five seconds, and incomplete runs fail. A 90-second deadline stops
unattended producer work. Finish/failure removes instrumentation, observers, and
timers and pauses all rendering. Correctness cases deliberately withhold painting,
inject visibility changes, and check failure cleanup. No speed thresholds run on
shared CI; use repeated runs on the same hardware/browser/display configuration
for comparisons, and compare throughput alongside latency.

The runner serves an in-memory production bundle and spawns no PTY for these
cases. Per-case `input.json` attachments and a combined
`e2e/test-results/input/input.json` include successes and failures, source commit
and dirty status, fixture chunk sizes and SHA-256, WASM hashes, host/CPU, browser,
viewport, font geometry, headless mode, profile, and repeat index. Reports retain
the count of the browser's `ResizeObserver loop completed with undelivered
notifications.` diagnostic separately: it means resize notifications were
deferred to a later frame. This counts notifications forwarded by Playwright's
page-error channel, not every native resize deferral. Other page errors fail the
case, with up to 16 messages
retained. A native resize-loop test checks this distinction without suppressing
browser events. Failed measurements retain
partial counters; failures before initialization have a null measurement.
Probe correctness tests are included in the report with null measurements.
CI uploads the directory as `terminal-input-responsiveness`.

## PTY input latency

```bash
pnpm bench:pty-input
WTERM_PTY_INPUT_PROFILE=measure pnpm bench:pty-input --project firefox --repeat-each 3
```

This separate production-bundle suite runs a raw-mode Node program in each of
one or eight real PTYs. The fixture requires both stdin and stdout to be TTYs;
it does not run a shell or shell line editor. Ghostty uses 80 columns by 24 rows.
The active terminal receives trusted Playwright keyboard events. Each lowercase
key passes through WTerm input, WebSocket, and the PTY before the child writes its
unique sequence marker back through the same PTY. There is no local echo. The
other seven panes are inert and rendering-paused, but continue parsing output.

The three workloads are idle, ANSI scrolling, and redraw. They use the same 32
complete chunks of at most 16 KiB as the local-echo suite. Each PTY submits one
chunk, waits for its stdout callback, then waits 16 ms before submitting another.
There are no catch-up bursts; actual throughput depends on scheduling and flow
control and is reported per session. The first probe waits for output from every
non-idle producer. The partial scroll region reserves row 1 for echo. The child
reports its final chunk, generated-byte, and probe counts; the suite checks those
counts against the fixture and every received byte against server accounting.

The server uses the local workspace's `PtyOutputQueue`: adjacent reads collect
until a four-millisecond timer fires or 16 KiB is available to send.
ACKs do not flush a collecting partial batch early. Queue limits, byte credit,
and socket backlog still apply, and process exit flushes the final batch.
Reports include PTY read and sent/received message counts to distinguish
reduced message overhead from reduced throughput.

Browser acknowledgments grant credit only after synchronous terminal parsing.
Each connection allows at most 64 KiB of unacknowledged output. PTY reads pause at
that limit and resume below 16 KiB; pending server output is capped at 1 MiB and
1,024 chunks. Overflow fails the measurement. The endpoint accepts only a fixed
workload, cumulative byte acknowledgments, start/stop controls, and at most 1,024
single lowercase keys. It shares the harness's loopback binding and exact
Host/Origin checks. It never accepts a command or executable path.

| Field | Boundary |
| --- | --- |
| `driver.requestToDOMReportMs` | Driver timestamp immediately before `page.keyboard.press` to receipt of the matching DOM-observation binding callback |
| `driver.requestToFrameReportMs` | Same request to receipt of a subsequent animation-callback report that rechecks the visible marker |
| `measurement.probes.keyDispatchToDOMMs` | Browser capture-phase key dispatch to matching DOM observation, including PTY/WebSocket round trip |
| `measurement.probes.keyDispatchToFrameMs` | Same browser dispatch to the subsequent animation callback |
| `measurement.sessions[].receivedMiBPerSecond` | Bytes received after starting the run through final PTY drain, including echo and final summary, per elapsed second |
| `measurement.sessions[].writeMs` / `renderMs` | Browser terminal writes and renderer calls during that interval; hidden panes must have zero render calls |
| `measurement.sessions[].flow` | Final sent/acknowledged bytes, PTY read and output-message counts, peak unacknowledged/pending bytes, pauses, and child exit status |
| `measurement.sessions[].receivedMessages` | All binary messages received, checked against the server's output-message count |
| `measurement.resources` | Before/after WASM capacity, mounted rows, DOM elements and retained history rows |

Driver timings use one clock outside the browser, so they include time waiting
for browser input dispatch. They also include automation command delivery and
binding-callback IPC, and are not an isolated measurement of the input queue.
Browser timings use a separate clock; the suite never subtracts timestamps from
different clocks. Observer/binding instrumentation affects results. Firefox
profiling also shows substantial work in Playwright's Juggler WebSocket
monitoring; automated results must not be treated as ordinary Firefox latency.
Neither measurement captures OS key delivery, physical display presentation, remote
network latency, or desktop Ghostty. This synthetic raw-mode workload does not
certify latency for every terminal application or the local workspace's transport.

Probes are serial and paced by completion. `smoke` uses 16 keys per case;
`measure` uses 256, with all samples retained up to the 1,024-key limit. Small
sample counts give limited evidence about tail latency. Write/render summaries
retain the latest 8,192 samples, with whole-run count, mean and maximum. A missing
echo fails after five seconds; the driver timeout runs outside the browser so a
blocked page cannot suppress it. Hidden pages, lost focus, overlapping input,
socket/process failure, and incomplete output drain also fail. Runs have a
90-second deadline. Finish, failure, page close, and server shutdown stop owned
producers and close their PTYs.

Correctness controls deliberately block browser dispatch for 750 ms and verify
that driver timing includes the stall; another withholds rendering and requires
failure rather than counting arbitrary frame callbacks. Server tests withhold
ACKs, resume credit, reject invalid controls, and verify child termination.
Shared CI applies no speed thresholds to the workload measurements.

Combined and per-case `pty-input.json` reports under `e2e/test-results/pty-input/`
include partial failures, driver and browser timings, fixture/source/WASM hashes,
host/CPU, Node and browser versions, headless mode, font geometry, repeat index,
queue statistics, and resource snapshots. Initialization failures have a null
measurement. CI uploads them as `terminal-pty-input`. Compare latency alongside
throughput using repeated runs on the same hardware and browser configuration.

### Sample PTY measurements before batching

On September 27, 2026, an Apple M1 Max running Darwin 25.6.0 arm64 and Node
24.20.0 completed three `measure` repeats per workload/configuration: 54 cases
and 13,824 echoes. These measurements predate small-read batching. The actual
reported headless viewport was 1280×720: device scale 1 for Chromium and Firefox,
and 2 for WebKit (the project device presets override the shared config).
The table gives ranges across the three repeats of both busy workloads
(ANSI and redraw). Throughput is summed across the indicated PTYs; timings are
`driver.requestToFrameReportMs`, including automation overhead.

| Browser | PTYs | p95 | p99 | Aggregate output |
| --- | --- | --- | --- | --- |
| Chromium 153.0.8010.12 | 1 | 49.9–50.9 ms | 50.2–54.7 ms | 0.73–0.89 MiB/s |
| Chromium 153.0.8010.12 | 8 | 48.9–52.0 ms | 49.8–67.4 ms | 5.30–7.11 MiB/s |
| Firefox 155.0 | 1 | 17.3–36.6 ms | 17.6–49.5 ms | 0.84–0.93 MiB/s |
| Firefox 155.0 | 8 | 167.2–201.4 ms | 174.6–269.8 ms | 5.76–6.49 MiB/s |
| WebKit 26.6 | 1 | 34.0–34.1 ms | 34.2–36.0 ms | 0.84–0.91 MiB/s |
| WebKit 26.6 | 8 | 34.0–34.4 ms | 34.6–45.1 ms | 6.58–7.02 MiB/s |

All expected echoes arrived, byte accounting matched, hidden panes made zero
renderer calls, and queues stayed within the declared bounds. Firefox's eight
busy PTYs had substantially longer latency than its idle and single-PTY cases.
These are measurements of this fixture and transport, not a physical-display
comparison or a guarantee for the local workspace or other applications.

### Small-read batching measurements

A follow-up on the same machine, browser versions, viewport, and device scales
used three 256-key repeats of every configuration with the shared batching queue.
Other CPU-intensive jobs were running on the host, so these timings are not a
controlled comparison or a latency guarantee. All busy cases completed; the
table summarizes their observed ranges. Reads per message is the aggregate
`ptyReads / outputMessages` ratio, including startup and drain.

| Browser | PTYs | p95 frame report | p99 frame report | Aggregate output | PTY reads per message |
| --- | --- | --- | --- | --- | --- |
| Chromium | 1 | 49.9–54.3 ms | 51.2–61.6 ms | 0.74–0.89 MiB/s | 7.2–10.4 |
| Chromium | 8 | 50.2–71.1 ms | 52.1–154.7 ms | 5.75–6.84 MiB/s | 8.0–12.6 |
| Firefox | 1 | 33.2–55.8 ms | 46.2–131.3 ms | 0.78–0.86 MiB/s | 6.8–11.1 |
| Firefox | 8 | 39.2–141.9 ms | 82.3–261.9 ms | 5.50–6.81 MiB/s | 7.9–13.3 |
| WebKit | 1 | 42.7–54.7 ms | 49.4–75.8 ms | 0.70–0.86 MiB/s | 7.0–10.7 |
| WebKit | 8 | 39.5–109.0 ms | 49.5–187.3 ms | 5.85–6.75 MiB/s | 8.0–12.3 |

Of the full 54-case matrix, 53 completed and one WebKit eight-PTY idle case
failed with a socket error after 100 echoes. That partial report is a failure,
not a successful timing sample. Six subsequent targeted repeats completed
without reproducing it. Reports now retain the failing session index and socket
error/close details. Completed cases preserved byte and message accounting,
stayed within queue bounds, and made zero hidden-pane renderer calls.

## History search measurements

```bash
pnpm bench:search
WTERM_SEARCH_PROFILE=stress pnpm bench:search --project chromium --repeat-each 3
```

The production bundle searches Ghostty at 80 columns by 24 rows, with a 128 MiB
history budget. `smoke` writes 10,000 numbered ASCII records; `stress` writes
100,000. Each record ends in CRLF and contains a fixed sentence plus `Needle`
at every thousandth record and the final record. The other query,
`not-in-this-corpus`, scans all rows without finding a match. Both use default
case-insensitive search. Every record and the final blank row must be retained;
the suite fails if any history was discarded. Preparation runs with painting
paused and is excluded from the timings.

| Field | Boundary |
| --- | --- |
| `firstResultsMs` | Search request to the first nonzero result-count callback; null for no matches |
| `completeMs` | Search request to the final callback with `searching: false` |
| `firstHighlightFrameMs` | Search request to an animation callback observing an active highlight; null for no matches |
| `frames` / `taskDelay` | Animation-callback intervals and delay beyond a requested 16 ms timer interval during the search |

The measurements include scheduling and harness overhead. A highlight-frame
callback observes DOM at a frame opportunity; it does not measure physical
presentation. Frame/task summaries keep at most 16,384 samples; whole-run
count/mean/max include all samples. A very fast search may finish before the
first task-delay sample. Hidden pages, explicit cancellation, or a 60-second
deadline fail the measurement and remove its callbacks/timers. Failure retains
partial results. Control cases check cancellation cleanup and timer fallback.

The runner spawns no PTY. Per-case attachments and the combined
`e2e/test-results/search/search.json` record the corpus hash, source commit/dirty
status, built search script, Ghostty bindings and WASM hashes, browser/headless mode, host/CPU, font geometry, retained rows,
match counts, bounded mounted rows, and failed cases. Browser resize deferrals
are counted separately from application errors as in the input suite. Failures
before initialization and control cases have null measurements. CI uploads the
directory as `terminal-history-search`; it checks correctness without timing
thresholds. Use the same hardware, browser, profile, and display configuration
with repeated runs for performance comparisons.

### Sample search comparison

On September 27, 2026, the `stress` profile ran each query three times per
browser on an Apple M1 Max, Darwin 25.6.0 arm64, Node 24.20.0, headless at
1280×900 and device scale 1. The table shows completion ranges across both
queries, rounded to milliseconds. The baseline is commit `df59d571`; the
updated decoder avoids temporary style objects, and the scanner skips
coordinate bookkeeping for unrelated single-character cells.

| Browser | Baseline | Updated |
| --- | --- | --- |
| Chromium 153.0.8010.12 | 766–846 ms | 456–475 ms |
| Firefox 155.0 | 1,506–1,544 ms | 748–812 ms |
| WebKit 26.6 | 887–983 ms | 469–498 ms |

All runs retained 100,001 rows without pruning and found the expected 101
matches or zero matches. Updated first-result callbacks arrived in 5–7 ms;
maximum frame intervals were 21/46/20 ms for Chromium/Firefox/WebKit. These
are local measurements of the fixed ASCII corpus, not universal latency
guarantees or measurements of physical presentation.

The updated report fingerprints are:

- Search script: `a8a23f42dc79f18445da4a2be6a9470fd9df8f6031cce6262fa628bcbb649cc9`
- Ghostty bindings: `9259e94ebfffb8b25b2f00377176e2b5f8750b22b1cdbcda3e1750d6059b374e`
- WASM (unchanged): `ac3cc614582520889a9e1c1d3fcfe03beeb4232811151444bec2dae09d0a772d`

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
| `input.html`, `src/input-main.ts` | Isolated local-echo page and one/eight session setup |
| `src/input.ts`, `src/input-workloads.ts`, `src/echo-probe.ts` | Bounded output producers, instrumentation, and matching DOM/frame echo probe |
| `pty-input.html`, `src/pty-input-main.ts`, `pty-input.config.ts` | Real-PTY input measurements and browser instrumentation |
| `pty-input-fixture.mjs`, `pty-input-server.mjs` | Raw-mode echo/output program, byte credit, and PTY lifecycle |
| `tests/pty-input-driver.ts`, `tests/pty-input.bench.ts`, `tests/pty-input-server.test.mjs` | Driver-clock timing, browser controls, and bounded-flow/process cleanup checks |
| `input.config.ts`, `tests/input*.bench.ts` | Input measurements, probe failure checks, and cleanup assertions |
| `search.html`, `src/search-main.ts`, `src/search-workload.ts` | Retained-history corpus and search timing/cleanup |
| `search.config.ts`, `tests/search.bench.ts` | Search measurements, correctness assertions, and cancellation controls |
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

`tests/transport.spec.ts` checks the packaged `WebSocketTransport` against the
same-origin `/transport` binary echo endpoint without spawning a shell. The
three browser engines verify bounded queued sends, ordered message boundaries,
UTF-8 and binary fidelity, pressure/drain transitions, and explicit-close cleanup.
Unit tests simulate slow socket buffers and reconnect races deterministically.
