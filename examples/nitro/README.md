# Nitro Example

Full terminal running on real PTYs allocated by a [Nitro](https://nitro.build) backend. Each in-app tab is a named session — the server spawns one PTY per session id via [zigpty](https://github.com/pithings/zigpty) and multiplexes it across every connected browser, so opening a second window mirrors all existing sessions (input, output, tabs, lifecycle) live. Theme switching included.

## Setup

From the monorepo root:

```bash
pnpm install
zig build
pnpm --filter nitro-example dev
```

## How It Works

- `@wterm/dom` renders the terminal — plain TS, no framework
- Nitro WebSocket route (`/terminal`) owns a `Map<sid, Session>` of shared PTYs
- On connect, the server sends a `tabs` sync message listing all live session ids; the client attaches an xterm to each
- `opened` / `closed` broadcasts keep every browser's tab bar in sync across windows
- Keystrokes flow browser → WS → PTY; PTY output fans out to all peers
- Per-session stats (pid, cwd, cpu%, rss, proc count, foreground proc) are sampled every second and broadcast
- Theme selector switches between Default, Solarized Dark, Monokai, and Light

## WebSocket Protocol

Client → server: `open`, `close`, `input`, `resize`, `rerender` (each carries a `sid`).
Server → client: `tabs` (initial sync), `opened`, `closed`, `data`, `stats`, `error`.

## Key Files

| File | Description |
|---|---|
| `app/entry-client.ts` | Client entry: tabs, terminal, WebSocket sync |
| `terminal.ts` | WebSocket handler: PTY-per-session map, broadcasts to all peers |
| `vite.config.ts` | Vite + Nitro plugin |
| `nitro.config.ts` | Nitro config (`features.websocket`, registers `/terminal` route) |
