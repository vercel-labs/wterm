# Development

## Prerequisites

- [Zig](https://ziglang.org/) 0.16.0+
- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) 11+

## Setup

```bash
pnpm install
```

## Build the WASM binary

```bash
zig build
```

For a release build:

```bash
zig build -Doptimize=ReleaseSmall
```

The built binary is committed at `packages/@wterm/core/wasm/wterm.wasm` and CI fails if it does not match the Zig sources, so rebuild and commit it with any change under `src/`.

## Build and verify Ghostty WASM

The Ghostty adapter uses Zig 0.15.2, Bash, and Python 3. Its build runs in fresh
caches under `/tmp` and leaves the shared Zig cache untouched. CI rebuilds it
and requires a byte-for-byte match with the committed artifact on every PR.
The adapter includes the upstream fix that zero-initializes new terminal
pages when the WASM allocator reuses memory.

```bash
pnpm --filter @wterm/ghostty rebuild-wasm
pnpm --filter @wterm/ghostty check-wasm
```

On macOS 26, use `rebuild-wasm:docker` or `check-wasm:docker`; Docker and CI
verify the pinned Linux compiler archive's SHA-256. Check mode leaves the
committed binary unchanged. See the [Ghostty build instructions](../packages/@wterm/ghostty/README.md#rebuilding-the-wasm).

## Regenerate the Unicode width table

`src/unicode_width_table.zig` holds the East Asian Width ranges the core uses to decide cell width. It is generated, not hand-edited. Run this when Unicode publishes a new version, after bumping `UNICODE_VERSION` in the script:

```bash
node scripts/gen-unicode-width.mjs
```

## Build all packages

```bash
pnpm build
```

## Run the documentation

The docs use Geistdocs with content in `apps/docs/content/docs`. Existing URLs stay at the site root, including `/get-started`, `/react`, and `/api-reference`. The homepage's interactive terminal uses `@wterm/ghostty` with just-bash. Its greeting renders with the page while the interactive terminal starts, and its Default preset follows the site's light, dark, or system theme, including in fullscreen. Ask AI keeps the wterm chat interface.

```bash
pnpm exec turbo run build --filter='@wterm/docs^...'
pnpm --filter @wterm/docs dev
```

Portless prints the local URL for `docs.wterm.localhost`. Documentation search, per-page Markdown (`/react.md`), `/llms.txt`, and `/sitemap.md` share the same content source. Compatible browsers expose the read-only WebMCP tools `search_docs` and `read_current_page`; ordinary browsers need no experimental features. Configuration lives in `apps/docs/src/lib/geistdocs/config.tsx`.

With the server running, verify the public route contract with Node.js, using the exact URL printed by Portless:

```bash
NODE_EXTRA_CA_CERTS="$HOME/.portless/ca.pem" DOCS_TEST_URL=https://docs.wterm.localhost:1355 node --test apps/docs/tests/docs-routes.test.mjs
```

CI also checks the production build with `pnpm --filter @wterm/docs test:routes`. This starts an isolated loopback server on an available port, runs the route suite, and shuts the server down. Build the docs first with `pnpm --filter @wterm/docs build`. Running the suite without a URL fails rather than silently skipping it.

After installing Playwright's Chromium, Firefox, and WebKit browsers, run `pnpm --filter @wterm/docs test:terminal` against the production build to check the homepage greeting before JavaScript, delayed startup, theme changes, fullscreen, and load failures. It owns the same isolated server lifecycle and runs in CI.

For responsive browser checks, install `agent-browser` separately and run `DOCS_TEST_URL=https://docs.wterm.localhost:1355 pnpm --filter @wterm/docs test:responsive`. It checks narrow, intermediate, and desktop widths in both themes, top/middle/bottom scroll positions, and chat opening/closing without making model requests. Screenshots and measurements go to `apps/docs/test-results/docs-responsive`, or `DOCS_ARTIFACT_DIR` when set. This optional browser check is separate from the dependency-free Node route suite in CI.

The header uses the shared Geistdocs OSS navbar, including its product menus. The custom wterm Ask AI launcher uses the primary button style and floats centered below 640px, or at the lower right on wider screens. On mobile it aligns vertically with the footer theme controls and respects the device safe area. On wider screens its base right and bottom margins are 80% of the footer theme control's right inset. As that control approaches the viewport, the launcher gradually recovers its full right inset so their right edges align at the footer. The bottom margin increases when needed to leave at least 16px above the theme control. It returns to its base position when scrolling away and disappears while chat is open. It does not replace or modify the shared header. The mobile docs menu and sticky table-of-contents button remain separate. The existing chat modes remain: a full-screen sheet below 640px and a resizable side panel on wider screens. The side panel leaves at least 320px for the documentation and header. Responsive checks close chat with its explicit Close panel button; Escape in the mobile terminal remains a known issue.

To test WebMCP with [agent-browser](https://github.com/vercel-labs/agent-browser), use a separate browser session and the local URL printed by Portless:

```bash
export AGENT_BROWSER_SESSION=wterm-webmcp-test
agent-browser --headed open https://docs.wterm.localhost:1355
agent-browser webmcp list
agent-browser --json webmcp invoke search_docs --params '{"query":"WebSocketTransport"}'
agent-browser open https://docs.wterm.localhost:1355/react
agent-browser --json webmcp invoke read_current_page --params '{}'
```

Both invocations should report `data.status: "completed"`. Reading after navigation should return the React documentation, not the homepage. The tools are read-only; they do not navigate automatically, run terminal commands, or send data to a model.

The full search payload includes highlighting and page/heading/text matches for agents and the search UI. For a compact manual view with `jq`:

```bash
agent-browser --json webmcp invoke search_docs --params '{"query":"WebSocketTransport"}' |
  jq -er 'if .success and .data.status == "completed" then .data.output[] | select(.type == "page" or .type == "heading") | [.content, .url] | @tsv else error("WebMCP search failed") end'
```

When finished, run `agent-browser close` to close only the test session.

Ask AI still requires the KV rate-limit configuration and model access; it returns 503 when KV is not configured. Search and WebMCP do not require model credentials.

## Run the vanilla demo

Serve the `web/` directory with any static file server:

```bash
cd web && python3 -m http.server 8000
```

For Kitty image support, use the Ghostty example instead. It loads
`@wterm/ghostty`, which provides the graphics-capable core; the built-in core
consumes unsupported Kitty APC payloads safely but does not decode images.

```bash
pnpm --filter ghostty-example dev
```

All terminal graphics are transient browser/WASM memory. Direct media is
accepted only within the Ghostty image budget (32 MiB by default), with a
32 MiB hard cap per image and 4,096 resident image/placement records per
screen; the DOM overlay separately caps visible canvas backing stores at 32 MiB
and bounds each canvas to the terminal pixel area. Set `imageStorageLimit: 0`
to disable Ghostty graphics. File paths, shared memory, URLs, Sixel,
iTerm2, animation, and virtual placements are not loaded.

Kitty graphics clients can use the Ghostty example's browser terminal
directly; `WTerm` reports the viewport and cell pixel sizes required by
commands such as `kitten icat --transfer-mode=stream image.png`.
Pixel-size queries can span text and byte writes; ordinary byte output does not
need a decoded string copy for query detection.
The local shell example also forwards the browser viewport dimensions to its
PTY, which lets `kitten icat --detect-support` work from that embedded shell.

## Run the Next.js example

All dev servers use [portless](https://github.com/vercel-labs/portless) to avoid hardcoded ports. Each app is served at a `.localhost` URL (e.g. `nextjs-example.wterm.localhost`).

```bash
cp web/wterm.wasm examples/nextjs/public/
pnpm --filter nextjs dev
```

## Run the Svelte example

The Svelte example uses `@wterm/svelte` with an in-browser `just-bash` shell,
theme switching, and imperative terminal controls:

```bash
pnpm --filter svelte-example dev
```

It opens at `svelte-example.wterm.localhost` through Portless.

## Run Zig tests

```bash
zig build test
```

## Run PTY and terminal replay tests

On macOS or Linux, test both cores against a real `/bin/sh` PTY and recorded
Neovim/tmux output in Chromium, Firefox, and WebKit:

```bash
pnpm exec playwright install chromium firefox webkit
pnpm test:pty
```

The runner builds the terminal packages and owns an isolated server on an
available loopback port. Tests cover browser keyboard input, shell execution,
resize, and exit. Replay cases check Unicode, styles, alternate screens,
history, and synchronized output. JSON timing reports, a combined `baseline.json`,
and failure traces are saved under `e2e/test-results/pty/`. CI runs the suite
and uploads those artifacts. Playback uses checked-in bytes; Neovim and tmux
are only needed to regenerate the recordings.
Linux requires a C++/Python toolchain for the permitted `node-pty` native build.

## Measure terminal output load

Run repeatable plain-text, ANSI-colored, and full-screen redraw workloads for
both cores in Chromium, Firefox, and WebKit:

```bash
pnpm bench:terminal
WTERM_LOAD_PROFILE=stress pnpm bench:terminal --project chromium --repeat-each 3
```

The default smoke profile writes 1 MiB per case; `stress` writes 100 MiB,
rounded up to a complete record. Reports under `e2e/test-results/load/` include
write/render timings, frame intervals, event-loop delays, sampled memory and DOM
size, workload hashes, and environment metadata. CI runs the smoke profile and
uploads the reports. These are instrumented browser measurements with a fixed
chunk schedule, not native-terminal throughput or physical display latency.
See the [harness documentation](../e2e/harness/README.md#output-load-measurements)
for measurement boundaries and comparison guidance.

## Check sustained output

Verify each batch of output before history discards it, check rendered text, and
sample resources after history starts pruning:

```bash
pnpm bench:stability
WTERM_STABILITY_PROFILE=soak pnpm bench:stability --project chromium --grep 'ghostty sustained output'
```

The short profile runs both engines in all three browsers. The `soak` profile
measures at least 30 minutes and 100 MiB per case after warmup. Runs fail on text
loss, stalled rendering, mounted-row overflow, or WASM capacity growth after
warmup. Bounded reports go to `e2e/test-results/stability/`; CI runs the short
profile and uploads them. JS heap observations include instrumentation and
ordinary garbage collection and do not establish leak freedom or process-memory
limits. See the [harness documentation](../e2e/harness/README.md#sustained-output-and-resource-checks)
for the workload and measurement boundaries.

## Measure input responsiveness

Measure native browser keyboard input with synchronous local echo while one or
eight sessions receive ANSI scrolling or screen redraws, alongside an idle case:

```bash
pnpm bench:input
WTERM_INPUT_PROFILE=measure pnpm bench:input --project chromium --repeat-each 3
```

The smoke profile checks 16 echoes per case; `measure` collects 256. Reports in
`e2e/test-results/input/` contain dispatch-to-DOM and dispatch-to-frame timings,
per-session output throughput and render counts, resource snapshots, and source
metadata. CI checks echo completion and inactive-pane rendering without hardware
timing thresholds. These local-echo measurements exclude input delivery before
browser dispatch, network/PTY latency, and physical presentation. See the
[harness documentation](../e2e/harness/README.md#input-responsiveness-measurements).

## Measure PTY input latency

Measure trusted keyboard input through a real PTY while one or eight Ghostty
terminals receive idle, ANSI, or redraw output:

```bash
pnpm bench:pty-input
WTERM_PTY_INPUT_PROFILE=measure pnpm bench:pty-input --project firefox --repeat-each 3
```

Reports under `e2e/test-results/pty-input/` include driver-request-to-echo timings
that include browser input queueing, plus browser-dispatch timings, PTY throughput,
queue bounds, and environment metadata. Driver timings include automation overhead;
frame callbacks indicate a paint opportunity, not physical presentation. See the
[harness documentation](../e2e/harness/README.md#pty-input-latency) for the fixture and
measurement boundaries.

## Measure history search

Search a fully retained Ghostty history with sparse matches and a no-match query:

```bash
pnpm bench:search
WTERM_SEARCH_PROFILE=stress pnpm bench:search --project chromium --repeat-each 3
```

The smoke profile retains 10,000 lines; `stress` retains 100,000. Reports under
`e2e/test-results/search/` record first results, completion, highlight-frame
opportunities, frame/task delays, retained history, and source/environment
metadata, including hashes of the search scanner, Ghostty bindings, and WASM.
CI checks correctness and cancellation without speed thresholds.
See the [harness documentation](../e2e/harness/README.md#history-search-measurements)
for the fixed corpus and measurement boundaries.

## Use the interactive harness

For interactive checks, run `pnpm --filter @internal/pty-harness dev` after the
package build above. Portless prints the URL for `pty-harness.wterm.localhost`.
The harness includes core switching and a round-trip probe. Timing callbacks
measure frame opportunities, not physical display latency. See the
[harness README](../e2e/harness/README.md) for setup and measurement details.

## Probe the public libghostty API

With Zig 0.16.0 and the Playwright browsers installed, build a pinned, unpatched
upstream WASM artifact and exercise its public C API in Node and all three
browser engines:

```bash
pnpm test:libghostty
```

The isolated [libghostty experiment](../experiments/libghostty/README.md) covers
render state, terminal effects, retained history, snapshots, and application
recordings. It documents the compatibility gaps that keep the shipped adapter
on v1.3.1. Generated binaries and reports stay in its ignored `dist/` directory.
