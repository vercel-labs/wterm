# Svelte Example

In-browser terminal running [just-bash](https://github.com/vercel-labs/just-bash) — no backend required. Includes theme switching, a virtual filesystem, and a local terminal over WebSocket. Svelte 5 + Vite port of the Vue example.

## Setup

From the monorepo root:

```bash
pnpm install
zig build
pnpm --filter svelte-example dev
```

Opens at `svelte-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/svelte` renders the terminal with `<Terminal>` and `bind:this`
- `@wterm/just-bash` provides a Bash shell that runs entirely in the browser
- Theme selector switches between Default, Solarized Dark, Monokai, and Light
- Virtual files (`README.md`, `package.json`, `main.zig`, `hello.sh`) are preloaded into the shell
- The local shell uses `node-pty` over a Vite WebSocket middleware

## Key Files

| File                         | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `src/App.svelte`             | Terminal page with theme picker + shell glue |
| `src/main.ts`                | App entry, imports `@wterm/svelte/css`       |
| `vite-plugins/pty-server.ts` | Local terminal WebSocket server              |
| `index.html`                 | HTML shell; `dark` class on `<html>`         |
