# ACP Agent Example

A web client for coding agents that speak the [Agent Client Protocol](https://agentclientprotocol.com). Each tool call is a card, and each card with output is its own `@wterm/dom` terminal, so command output keeps its colors and stays readable while it streams.

## Setup

From the monorepo root:

```bash
pnpm install
zig build
pnpm turbo run build --filter='acp-agent^...'
pnpm --filter acp-agent dev
```

Opens at `acp-agent-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

The server starts `fx acp` in the current directory by default. Set `ACP_AGENT` to run another ACP agent, and `ACP_CWD` to choose its workspace:

```bash
ACP_AGENT="fx acp" ACP_CWD=~/code/my-app pnpm --filter acp-agent dev
```

## How It Works

- `server.ts` serves the page through Vite and starts one agent process per browser tab. It speaks ACP over the agent's stdin and stdout and sends the page one batch of events at a time over a WebSocket.
- The agent can run commands in your workspace, so the server only accepts requests for local host names and WebSocket connections from its own page. The page carries a token generated for each run, and a connection without it is refused before an agent starts.
- `src/acp-events.ts` turns ACP `session/update` messages into transcript events: messages, thoughts, tool calls, and their output. Edit tools that send `old_string` and `new_string`, and ACP `diff` content, render as a colored diff.
- `src/main.ts` creates a terminal only when a card scrolls into view, writes each terminal at most once per frame, and pauses painting for cards outside the viewport. When a finished card leaves the viewport, its terminal is destroyed and its output is kept, so it can be written into a new terminal when the card comes back. See [Many terminals on one page](https://wterm.dev/configuration#many-terminals-on-one-page).
- Hovering or focusing a card header shows the tool's input and, for agents that report it, the exit code and duration.

Agents send command output as plain text unless they keep terminal escapes. The page asks fx for them with `_meta.fx.ansiOutput` on `initialize`, and the header notes whether the agent keeps them.

## Key Files

| File                | Description                                      |
| ------------------- | ------------------------------------------------ |
| `server.ts`         | Vite server, WebSocket bridge, and ACP client    |
| `src/acp-events.ts` | ACP session updates to transcript events         |
| `src/main.ts`       | Transcript, tool cards, and terminal mounting    |
| `src/protocol.ts`   | Events exchanged between the server and the page |
| `index.html`        | Header, transcript, and prompt box               |
