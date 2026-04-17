# Vue Example

In-browser terminal running [just-bash](https://github.com/vercel-labs/just-bash) — no backend required. Includes theme switching and a virtual filesystem. Vue 3 + Vite port of the Next.js example.

## Setup

From the monorepo root:

```bash
pnpm install
zig build
pnpm --filter vue dev
```

Opens at `vue-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/vue` renders the terminal with `<Terminal>` + template ref
- `@wterm/just-bash` provides a Bash shell that runs entirely in the browser
- Theme selector switches between Default, Solarized Dark, Monokai, and Light
- Virtual files (`README.md`, `package.json`, `main.zig`, `hello.sh`) are preloaded into the shell

## Key Files

| File          | Description                                  |
| ------------- | -------------------------------------------- |
| `src/App.vue` | Terminal page with theme picker + shell glue |
| `src/main.ts` | App entry, imports `@wterm/vue/css`          |
| `index.html`  | HTML shell; `dark` class on `<html>`         |
