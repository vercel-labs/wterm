# Markdown Streaming Example

Stream LLM output into a terminal using `@wterm/react`, `@wterm/markdown`, and the [AI SDK](https://sdk.vercel.ai). Chat messages are sent to an API route that streams responses via AI Gateway, and the terminal renders incoming Markdown as ANSI in real time.

## Setup

From the monorepo root:

```bash
pnpm install
zig build
```

Copy the env file and add your API key:

```bash
cp examples/markdown-streaming/.env.example examples/markdown-streaming/.env.local
```

Then start the dev server:

```bash
pnpm --filter markdown-streaming dev
```

Opens at `markdown-streaming-example.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `@wterm/react` renders the terminal with `<Terminal>` and `useTerminal`
- A `ChatShell` class handles user input and sends messages to `/api/chat`
- The API route uses AI SDK `streamText` with `openai/gpt-4o-mini` (AI Gateway) to stream responses
- Response chunks are piped through `@wterm/markdown`'s `MarkdownRenderer`, converting Markdown to ANSI escape sequences in real time
- Press `Ctrl+C` during a response to abort the stream

## Key Files

| File | Description |
|---|---|
| `src/app/page.tsx` | Terminal page with `ChatShell` that streams responses through `MarkdownRenderer` |
| `src/app/api/chat/route.ts` | API route using AI SDK `streamText` |
| `src/app/layout.tsx` | Root layout |
