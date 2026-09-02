# Local Shell Example

Full local terminal in the browser, connected to your machine's shell via WebSocket and [node-pty](https://github.com/microsoft/node-pty). Use the left sidebar to create, switch between, and close multiple independent shell sessions.

## Setup

From the monorepo root:

```bash
pnpm install
zig build
pnpm --filter local dev
```

Opens at `local-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `server.ts` starts an HTTP + WebSocket server alongside Next.js
- On each WebSocket connection, a PTY process is spawned with your default shell
- The browser sends keystrokes over WebSocket; the server relays PTY output back
- Terminal resizing, including browser pixel dimensions, is forwarded to the PTY via a custom escape sequence
- The server restores PTY pixel dimensions after each resize so Kitty clients such as `kitten icat` can detect image support
- Each sidebar tab keeps its terminal and shell session alive while other tabs are active
- The `/ghostty` route uses the graphics-capable core and limits rendered Kitty images to 640×480 CSS pixels
- Auto-sized Kitty images align with the terminal content origin and reserve their rendered height visually so the following shell prompt appears below the image
- Each session displays its full current working directory in the sidebar, abbreviating the home directory as `~` and updating after `cd`

## Key Files

| File | Description |
|---|---|
| `server.ts` | Custom server with WebSocket ↔ PTY bridge |
| `app/page.tsx` | Built-in-core entry point |
| `app/ghostty/page.tsx` | Ghostty-core entry point with bounded Kitty image rendering |
| `app/session-workspace.tsx` | Sidebar, session tabs, and terminal/WebSocket lifecycle |
| `app/layout.tsx` | Root layout with metadata |
