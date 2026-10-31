# Svelte Example

In-browser terminal running [just-bash](https://github.com/vercel-labs/just-bash)
through the `@wterm/svelte` component. It demonstrates Svelte 5 callback props,
imperative component methods, theme switching, and browser-native terminal
selection.

## Setup

From the monorepo root:

```bash
pnpm install
pnpm --filter svelte-example dev
```

Opens at `svelte-example.wterm.localhost` via
[portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/svelte` owns the terminal lifecycle and forwards input through `onData`
- `@wterm/just-bash` runs the shell entirely in the browser
- Svelte callback props handle readiness, input, and title updates
- The theme selector updates the component's `theme` prop without remounting it
- Virtual files (`README.md`, `hello.sh`) are preloaded into the shell

## Key Files

| File | Description |
|---|---|
| `src/App.svelte` | Terminal UI, shell setup, callbacks, controls, and theme picker |
| `src/main.ts` | Mounts the Svelte app and imports global styles |
| `src/style.css` | Example page and control styling |
| `vite.config.ts` | Svelte plugin and Portless host configuration |
| `svelte.config.js` | Svelte compiler configuration |
| `index.html` | HTML shell |
