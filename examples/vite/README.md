# Vite Example

Minimal Vite + vanilla TypeScript terminal running [just-bash](https://github.com/vercel-labs/just-bash) — no React, no framework, just a `<div>` and `@wterm/dom`.

## Setup

From the monorepo root:

```bash
pnpm install
zig build
pnpm --filter vite dev
```

Opens at `vite-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/dom` creates and manages the terminal in a plain `<div>`
- `@wterm/just-bash` provides a Bash shell that runs entirely in the browser
- Virtual files (`README.md`, `hello.sh`) are preloaded into the shell

## Key Files

| File | Description |
|---|---|
| `src/main.ts` | Creates the terminal and attaches a bash shell |
| `index.html` | Minimal HTML with `<div id="terminal">` |
