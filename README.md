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
- **24-bit color** — full RGB SGR support
- **Auto-resize** — `ResizeObserver`-based terminal resizing
- **WebSocket transport** — connect to a PTY backend with binary framing and reconnection
- **Mouse and focus reporting** — DOM input for SGR mouse tracking and terminal focus events

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

### Run the vanilla demo

Serve the `web/` directory with any static file server:

```bash
cd web && python3 -m http.server 8000
```

### Run the Next.js example

All dev servers use [portless](https://github.com/vercel-labs/portless) to avoid hardcoded ports. Each app is served at a `.localhost` URL (e.g. `nextjs-example.wterm.localhost`).

```bash
cp web/wterm.wasm examples/nextjs/public/
pnpm --filter nextjs dev
```

### Run Zig tests

```bash
zig build test
```

## License

Apache-2.0
