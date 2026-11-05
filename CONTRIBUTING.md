# Contributing

Thanks for contributing to wterm!

## Issues

Search existing issues before opening a new one. For bugs, include reproduction
steps, expected and actual behavior, and the relevant browser, operating system,
and package versions. A small reproducible example is especially helpful.

For larger changes, open an issue to discuss the approach before starting work.

## Pull requests

See [Development](#development) for setup and the test suites. Keep changes
focused and describe the problem they solve. Add or update tests when behavior
changes, update relevant documentation, and run the checks appropriate to your
change before opening a pull request.

## Development

You need [Zig](https://ziglang.org/) 0.16.0 or later, Node.js 24 or later, pnpm
11, and [portless](https://github.com/vercel-labs/portless) installed globally.
Every dev server runs at a `.localhost` URL that portless prints, such as
`nextjs-example.wterm.localhost`.

```bash
pnpm install
zig build test
pnpm build
```

### Built-in core WASM

```bash
zig build -Doptimize=ReleaseSmall
```

The release build writes `zig-out/bin/wterm.wasm` and `web/wterm.wasm`. The
packages ship `packages/@wterm/core/wasm/wterm.wasm`, and CI fails if that file
does not match a release build of the Zig sources. Copy the new binary there and
commit it with any change under `src/`.

`src/unicode_width_table.zig` holds the East Asian Width ranges the core uses to
decide cell width. It is generated. When Unicode publishes a new version, bump
`UNICODE_VERSION` in the script and run:

```bash
node scripts/gen-unicode-width.mjs
```

### Ghostty WASM

The Ghostty adapter builds with Zig 0.15.2, Bash, and Python 3, in fresh caches
under `/tmp` that leave the shared Zig cache untouched. The adapter includes the
upstream fix that zero-initializes new terminal pages when the WASM allocator
reuses memory. CI rebuilds it on every PR and requires a byte-for-byte match with
the committed artifact.

```bash
pnpm --filter @wterm/ghostty rebuild-wasm
pnpm --filter @wterm/ghostty check-wasm
```

On macOS 26, use `rebuild-wasm:docker` or `check-wasm:docker`. Check mode leaves
the committed binary unchanged. See the
[Ghostty build instructions](packages/@wterm/ghostty/README.md#rebuilding-the-wasm).

With Zig 0.16.0 and the Playwright browsers installed, `pnpm test:libghostty`
builds a pinned, unpatched upstream WASM artifact and exercises its public C API
in Node and all three browser engines. The
[libghostty experiment](experiments/libghostty/README.md) documents the
compatibility gaps that keep the shipped adapter on v1.3.1.

### Examples

Each example under `examples/` has a README with its setup. From the repo root,
run one with its package name:

```bash
pnpm --filter nextjs dev
pnpm --filter svelte-example dev
pnpm --filter ghostty-example dev
```

Use the Ghostty example for Kitty images: the built-in core consumes Kitty APC
payloads safely but does not decode images.

### Docs site

The docs use Geistdocs with content in `apps/docs/content/docs` and
configuration in `apps/docs/src/lib/geistdocs/config.tsx`. URLs stay at the site
root, such as `/get-started` and `/react`. Search, per-page Markdown
(`/react.md`), `/llms.txt`, and `/sitemap.md` share the same content source.

```bash
pnpm exec turbo run build --filter='@wterm/docs^...'
pnpm --filter @wterm/docs dev
```

The homepage terminal uses `@wterm/ghostty` with just-bash. Its greeting renders
with the page while the terminal starts, and its Default preset follows the
site's light, dark, or system theme, including in fullscreen.

With the dev server running, check the public route contract against the URL
portless printed:

```bash
NODE_EXTRA_CA_CERTS="$HOME/.portless/ca.pem" DOCS_TEST_URL=https://docs.wterm.localhost:1355 node --test apps/docs/tests/docs-routes.test.mjs
```

CI runs the same suite against a production build with
`pnpm --filter @wterm/docs test:routes`, which starts an isolated loopback
server on a free port. Build the docs first with
`pnpm --filter @wterm/docs build`. Run without a URL, the suite fails instead of
skipping. After installing Playwright's Chromium, Firefox, and WebKit,
`pnpm --filter @wterm/docs test:terminal` checks the homepage greeting before
JavaScript, delayed startup, theme changes, fullscreen, and load failures. CI
runs it too.

`DOCS_TEST_URL=https://docs.wterm.localhost:1355 pnpm --filter @wterm/docs test:responsive`
needs `agent-browser` installed separately. It checks narrow, intermediate, and
desktop widths in both themes, top, middle, and bottom scroll positions, and
chat opening and closing without model requests. Screenshots and measurements go
to `apps/docs/test-results/docs-responsive`, or to `DOCS_ARTIFACT_DIR` when set.
CI does not run it.

The header is the shared Geistdocs OSS navbar, and the wterm Ask AI launcher
does not modify it. The launcher floats centered below 640px and at the lower
right on wider screens. On mobile it aligns with the footer theme controls and
respects the safe area. On wider screens its right and bottom margins start at
80% of the footer theme control's right inset, and the right inset recovers as
that control approaches the viewport so their right edges align at the footer.
The bottom margin grows when needed to keep at least 16px above the theme
control. The launcher hides while chat is open. Chat opens as a full-screen
sheet below 640px and as a resizable side panel on wider screens that leaves at
least 320px for the docs and header. Responsive checks close chat with its
**Close panel** button, because Escape in the mobile terminal is a known issue.

Ask AI needs the KV rate-limit configuration and model access, and returns 503
without KV. Search and the read-only WebMCP tools `search_docs` and
`read_current_page` need no model credentials. To try the tools with
[agent-browser](https://github.com/vercel-labs/agent-browser) in a separate
session:

```bash
export AGENT_BROWSER_SESSION=wterm-webmcp-test
agent-browser --headed open https://docs.wterm.localhost:1355
agent-browser webmcp list
agent-browser --json webmcp invoke search_docs --params '{"query":"WebSocketTransport"}'
agent-browser open https://docs.wterm.localhost:1355/react
agent-browser --json webmcp invoke read_current_page --params '{}'
agent-browser close
```

Both invocations report `data.status: "completed"`, and the read after
navigation returns the React page. The tools do not navigate, run terminal
commands, or send data to a model. For a compact view of search results:

```bash
agent-browser --json webmcp invoke search_docs --params '{"query":"WebSocketTransport"}' |
  jq -er 'if .success and .data.status == "completed" then .data.output[] | select(.type == "page" or .type == "heading") | [.content, .url] | @tsv else error("WebMCP search failed") end'
```

### PTY, replay, and performance suites

These suites run in Chromium, Firefox, and WebKit after
`pnpm exec playwright install chromium firefox webkit`. Each one builds the
terminal packages and runs an isolated server on a free loopback port. Reports
go under `e2e/test-results/`. CI runs each suite with its default profile and
applies no speed thresholds. The
[harness README](e2e/harness/README.md) documents the workloads, profiles, and
what each measurement does and does not include.

| Command | What it checks | Details |
|---|---|---|
| `pnpm test:pty` | Both cores against a real `/bin/sh` PTY, plus recorded Neovim and tmux output. macOS or Linux; Linux needs a C++ and Python toolchain for `node-pty`. | [Recorded workloads](e2e/harness/README.md#recorded-workloads) |
| `pnpm bench:terminal` | Plain, ANSI, and full-screen redraw output load. `WTERM_LOAD_PROFILE=stress` writes 100 MiB per case. | [Output load](e2e/harness/README.md#output-load-measurements) |
| `pnpm bench:stability` | Text loss, stalls, and resource growth under sustained output. `WTERM_STABILITY_PROFILE=soak` runs 30 minutes per case. | [Sustained output](e2e/harness/README.md#sustained-output-and-resource-checks) |
| `pnpm bench:input` | Keyboard echo while one or eight sessions receive output. `WTERM_INPUT_PROFILE=measure` collects 256 echoes. | [Input responsiveness](e2e/harness/README.md#input-responsiveness-measurements) |
| `pnpm bench:pty-input` | Trusted keyboard input through a real PTY. `WTERM_PTY_INPUT_PROFILE=measure` for full runs. | [PTY input latency](e2e/harness/README.md#pty-input-latency) |
| `pnpm bench:search` | Find over retained Ghostty history. `WTERM_SEARCH_PROFILE=stress` retains 100,000 lines. | [History search](e2e/harness/README.md#history-search-measurements) |

For interactive checks, run `pnpm --filter @internal/pty-harness dev` after
`pnpm build`. It serves `pty-harness.wterm.localhost` with core switching and a
round-trip probe.

## Writing with AI coding agents

If an AI coding agent writes any of your contribution's prose, it must use the
[`technical-writer` skill](.agents/skills/technical-writer/SKILL.md). That
covers docs pages, READMEs, changelog entries, commit messages, PR descriptions,
and issues. The skill sets the voice and editorial standards for this repo and
asks agents to check technical claims against the source. Agents that read this
repo's `AGENTS.md` pick up the requirement automatically.
