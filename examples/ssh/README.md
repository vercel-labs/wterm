# SSH Client Example

Browser-based SSH client. Connects to remote servers via a WebSocket-to-SSH bridge using [ssh2](https://github.com/mscdex/ssh2).

## Setup

From the monorepo root:

```bash
pnpm install
zig build
pnpm --filter ssh dev
```

Opens at `ssh-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `server.ts` starts an HTTP + WebSocket server alongside Next.js
- The browser sends SSH connection params (host, port, username, auth) as the first WebSocket message
- The server opens an SSH connection and pipes the shell stream to/from the WebSocket
- Supports password and private key authentication

## Key Files

| File | Description |
|---|---|
| `server.ts` | Custom server with WebSocket ↔ SSH bridge |
| `app/page.tsx` | Connection form and terminal UI |
| `app/layout.tsx` | Root layout with metadata |
