# Ghostty Core Example

Minimal Vite + vanilla TypeScript terminal using the [libghostty](https://ghostty.org) backend (built from source) via `@wterm/ghostty` instead of wterm's built-in Zig core.

## Setup

From the monorepo root:

```bash
pnpm install
pnpm --filter ghostty-example dev
```

Opens at `ghostty-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/ghostty` loads the ghostty-vt WASM binary (~400 KB, built from upstream ghostty source) and creates a `GhosttyCore` instance
- The core is passed to `WTerm` via the `core` option — from that point on, everything works identically to the built-in core
- `@wterm/dom` renders the terminal grid into the DOM as usual, consuming `TerminalCore` methods

## Key Files

| File | Description |
|---|---|
| `src/main.ts` | Loads the Ghostty core and creates the terminal |
| `index.html` | Minimal HTML with `<div id="terminal">` |
