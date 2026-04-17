# Svelte Example

Svelte + Vite example showing `@wterm/svelte` running an in-browser [just-bash](https://github.com/vercel-labs/just-bash) shell.

## Setup

From the monorepo root:

```bash
pnpm install
pnpm --filter @wterm/core build
pnpm --filter @wterm/dom build
pnpm --filter @wterm/svelte build
pnpm --filter @wterm/just-bash build
pnpm --filter svelte-example dev
```

Opens at `svelte-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/svelte` attaches the terminal with a Svelte action
- `@wterm/just-bash` provides a Bash shell that runs entirely in the browser
- The terminal is themed with the built-in Monokai theme and auto-resizes with the page

## Key Files

| File | Description |
|---|---|
| `src/App.svelte` | Attaches the terminal action and wires up the bash shell |
| `src/main.ts` | Mounts the Svelte app |
| `vite.config.ts` | Enables the Svelte plugin in Vite |
