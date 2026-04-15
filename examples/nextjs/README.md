# Next.js Example

In-browser terminal running [just-bash](https://github.com/vercel-labs/just-bash) — no backend required. Includes theme switching and a virtual filesystem.

## Setup

From the monorepo root:

```bash
pnpm install
zig build
pnpm --filter nextjs dev
```

Opens at `nextjs-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/react` renders the terminal with `<Terminal>` and `useTerminal`
- `@wterm/just-bash` provides a Bash shell that runs entirely in the browser
- Theme selector switches between Default, Solarized Dark, Monokai, and Light
- Virtual files (`README.md`, `package.json`, `main.zig`, `hello.sh`) are preloaded into the shell

## Key Files

| File | Description |
|---|---|
| `app/page.tsx` | Terminal page with theme picker and shell setup |
| `app/layout.tsx` | Root layout with metadata |
