# React + Vite Example

React 19 + Vite example showing `@wterm/react` running an in-browser [just-bash](https://github.com/vercel-labs/just-bash) shell.

## Setup

From the monorepo root:

```bash
pnpm install
pnpm --filter @wterm/core build
pnpm --filter @wterm/dom build
pnpm --filter @wterm/react build
pnpm --filter @wterm/just-bash build
pnpm --filter react-vite-example dev
```

Opens at `react-vite-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/react` renders the terminal as a React component
- `@wterm/just-bash` provides a Bash shell that runs entirely in the browser
- The terminal is themed with the built-in Monokai theme and auto-resizes with the page

## Key Files

| File | Description |
|---|---|
| `src/App.tsx` | Mounts the terminal component and attaches the bash shell |
| `src/main.tsx` | Bootstraps the React app |
| `vite.config.ts` | Enables the React plugin in Vite |
