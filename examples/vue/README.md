# Vue Example

Vue 3 + Vite example showing `@wterm/vue` running an in-browser [just-bash](https://github.com/vercel-labs/just-bash) shell.

## Setup

From the monorepo root:

```bash
pnpm install
pnpm --filter @wterm/core build
pnpm --filter @wterm/dom build
pnpm --filter @wterm/vue build
pnpm --filter @wterm/just-bash build
pnpm --filter vue-example dev
```

Opens at `vue-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/vue` renders the terminal as a Vue 3 component
- `@wterm/just-bash` provides a Bash shell that runs entirely in the browser
- The terminal is themed with the built-in Monokai theme and auto-resizes with the page

## Key Files

| File | Description |
|---|---|
| `src/App.vue` | Mounts the terminal component and attaches the bash shell |
| `src/main.ts` | Bootstraps the Vue app |
| `vite.config.ts` | Enables Vue SFC support in Vite |
