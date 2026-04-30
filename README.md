# wterm

A terminal emulator for the web.

wterm ("dub-term") renders to the DOM — native text selection, copy/paste, find, and accessibility come for free. The core is written in Zig and compiled to WASM for near-native performance.

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
- **DOM rendering** — native text selection, clipboard, browser find, and screen reader support
- **Dirty-row tracking** — only touched rows are re-rendered each frame via `requestAnimationFrame`
- **Themes** — CSS custom properties with built-in Default, Solarized Dark, Monokai, and Light themes
- **Alternate screen buffer** — `vim`, `less`, `htop`, and similar apps work correctly
- **Scrollback history** — configurable ring buffer
- **24-bit color** — full RGB SGR support
- **Auto-resize** — `ResizeObserver`-based terminal resizing
- **WebSocket transport** — connect to a PTY backend with binary framing and reconnection

## Development

### Prerequisites

- [Zig](https://ziglang.org/) 0.16.0+
- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- [portless](https://github.com/vercel-labs/portless) — `npm i -g portless`

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
