# Nitro Example

Full terminal running on real PTYs allocated by a [Nitro](https://nitro.build) backend. Each **in-app tab** is a named session (`/_ws?id=...`); the server lazily spawns one PTY per session id with [zigpty](https://github.com/pithings/zigpty) and multiplexes it to every browser window attached to that id — so opening the same session id in two browser tabs shares a shell, while hitting the `+` button spawns a fresh one. Theme switching included.

## Setup

From the monorepo root:

```bash
pnpm install
zig build
pnpm --filter nitro-example dev
```

## How It Works

- `@wterm/dom` renders the terminal — plain TS, no framework
- Nitro WebSocket route (`/terminal`) lazily allocates one shared PTY with `zigpty`
- Every peer writes to the same PTY and receives a broadcast of its output
- Keystrokes flow browser → WS → PTY; PTY output flows back to all peers
- Resize is forwarded with an inline `\x1b[RESIZE:cols;rows]` control sequence
- Theme selector switches between Default, Solarized Dark, Monokai, and Light

## Key Files

| File | Description |
|---|---|
| `app/entry-client.ts` | Client entry: terminal + WebSocket wiring |
| `terminal.ts` | WebSocket handler: single shared PTY per session id, broadcasts to all peers |
| `vite.config.ts` | Vite + Nitro plugin |
| `nitro.config.ts` | Nitro config (`features.websocket`, registers `/terminal` route) |
