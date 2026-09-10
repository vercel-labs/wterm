# wterm

A terminal emulator for the web.

wterm ("dub-term") renders to the DOM — native text selection, copy/paste, find, and accessibility work directly on the mounted rows. The core is written in Zig and compiled to WASM for near-native performance.

## Packages

| Package | Description |
|---|---|
| [`@wterm/core`](packages/@wterm/core) | Headless WASM bridge, `TerminalCore` interface, WebSocket transport |
| [`@wterm/dom`](packages/@wterm/dom) | DOM renderer, input handler — vanilla JS terminal |
| [`@wterm/react`](packages/@wterm/react) | React component + `useTerminal` hook (TypeScript) |
| [`@wterm/vue`](packages/@wterm/vue) | Vue 3 component + template ref API |
| [`@wterm/svelte`](packages/@wterm/svelte) | Svelte component + callback API |
| [`@wterm/ghostty`](packages/@wterm/ghostty) | Full-featured VT emulation core powered by libghostty |
| [`@wterm/just-bash`](packages/@wterm/just-bash) | In-browser Bash shell powered by just-bash |
| [`@wterm/markdown`](packages/@wterm/markdown) | Render Markdown in the terminal |

## Features

- **Pluggable cores** — built-in lightweight Zig core (~12 KB) or opt-in [libghostty](packages/@wterm/ghostty) backend (~400 KB) for full VT compliance
- **Zig + WASM core** — VT100/VT220/xterm escape sequence parser compiled to a ~12 KB `.wasm` binary (release build)
- **DOM rendering** — native text selection, clipboard, browser find, and screen reader support for mounted rows
- **Native hyperlinks** — OSC 8 links remain attached to their exact cells through viewport and scrollback, with safe HTTP(S) anchors
- **Dirty-row tracking** — only touched rows are re-rendered each frame via `requestAnimationFrame`
- **Frame-direct scheduling** — writes queue their render on the next animation frame without an extra timer hop
- **Synchronized output** — mode 2026 blocks paint atomically with a bounded recovery deadline
- **Themes** — CSS custom properties with built-in Default, Solarized Dark, Monokai, and Light themes
- **Alternate screen buffer** — `vim`, `less`, `htop`, and similar apps work correctly
- **Windowed scrollback history** — configurable ring buffer with a bounded visible DOM window
- **Wide Unicode cells** — CJK, fullwidth, and emoji codepoints keep cursor-addressed redraws aligned
- **Grapheme strings** — the Ghostty core preserves combining marks and ZWJ emoji through the DOM renderer and scrollback
- **Kitty terminal images** — Ghostty-backed terminals render direct PNG/RGB/RGBA graphics in a scroll-aware canvas overlay with configurable display bounds; implicit image placements keep following prompts visually below the image
- **24-bit color** — full RGB SGR support
- **Auto-resize** — `ResizeObserver`-based terminal resizing
- **Framework bindings** — React, Vue 3, and Svelte components
- **WebSocket transport** — connect to a PTY backend with binary framing and reconnection
- **Mouse and focus reporting** — DOM input for SGR mouse tracking and terminal focus events
- **Kitty keyboard protocol**: negotiated key disambiguation, event types, alternate keys, all-key reporting, and associated text

## Development

### Prerequisites

- [Zig](https://ziglang.org/) 0.16.0+
- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) 11+

### Setup

```bash
pnpm install
```

### Build the WASM binary

```bash
zig build
```

For a release build:

```bash
zig build -Doptimize=ReleaseSmall
```

The built binary is committed at `packages/@wterm/core/wasm/wterm.wasm` and CI fails if it does not match the Zig sources, so rebuild and commit it with any change under `src/`.

### Regenerate the Unicode width table

`src/unicode_width_table.zig` holds the East Asian Width ranges the core uses to decide cell width. It is generated, not hand-edited. Run this when Unicode publishes a new version, after bumping `UNICODE_VERSION` in the script:

```bash
node scripts/gen-unicode-width.mjs
```

### Build all packages

```bash
pnpm build
```

### Run the documentation

The docs use Geistdocs with content in `apps/docs/content/docs`. Existing URLs stay at the site root, including `/get-started`, `/react`, and `/api-reference`. The homepage keeps the interactive terminal, and Ask AI keeps the wterm chat interface.

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

For responsive browser checks, install `agent-browser` separately and run `DOCS_TEST_URL=https://docs.wterm.localhost:1355 pnpm --filter @wterm/docs test:responsive`. It checks narrow, intermediate, and desktop widths in both themes, top/middle/bottom scroll positions, and chat opening/closing without making model requests. Screenshots and measurements go to `apps/docs/test-results/docs-responsive`, or `DOCS_ARTIFACT_DIR` when set. This optional browser check is separate from the dependency-free Node route suite in CI.

Ask AI is a compact outline button in the sticky header, immediately after Search on desktop and before the menu on smaller layouts. The mobile docs menu and sticky table-of-contents button remain separate from the header. The existing chat modes remain: a full-screen sheet below 640px and a resizable side panel on wider screens. The side panel leaves at least 320px for the documentation and header. The small-screen header menu is a non-modal dropdown, so opening Search and resizing do not leave a modal scroll lock behind.

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

### Run the vanilla demo

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
The local shell example also forwards the browser viewport dimensions to its
PTY, which lets `kitten icat --detect-support` work from that embedded shell.

### Run the Next.js example

All dev servers use [portless](https://github.com/vercel-labs/portless) to avoid hardcoded ports. Each app is served at a `.localhost` URL (e.g. `nextjs-example.wterm.localhost`).

```bash
cp web/wterm.wasm examples/nextjs/public/
pnpm --filter nextjs dev
```

### Run the Svelte example

The Svelte example uses `@wterm/svelte` with an in-browser `just-bash` shell,
theme switching, and imperative terminal controls:

```bash
pnpm --filter svelte-example dev
```

It opens at `svelte-example.wterm.localhost` through Portless.

### Run Zig tests

```bash
zig build test
```

## License

Apache-2.0
