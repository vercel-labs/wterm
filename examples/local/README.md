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
- **Read output** opens a stable snapshot of retained history and the active screen in a labelled, read-only text area. Use native keyboard navigation and Copy, **Refresh** to capture newer output, and **Close** or Escape to return to the opener. Output keeps running while the snapshot stays unchanged. A capture interrupted by output or resize can be retried; captures above 16,777,216 UTF-16 units fail without returning partial text. Closing cancels pending capture and releases the snapshot.
- The editable terminal input uses its session name for assistive technology; inactive sessions are excluded from page tab entry. Escape followed by Tab or Shift+Tab moves focus back to the page
- The `/ghostty` route uses the graphics-capable core and limits rendered Kitty images to 640×480 CSS pixels
- Auto-sized Kitty images align with the terminal content origin and reserve their rendered height visually so the following shell prompt appears below the image
- Each session displays its full current working directory in the sidebar, abbreviating the home directory as `~` and updating after `cd`
- Select terminal text and use the browser's normal Copy action. On `/ghostty`, wrapped commands copy without added newlines; explicit line breaks, whole Unicode cells, and block glyphs are preserved. Trailing padding is trimmed at fully selected hard row ends. Hold Shift to select when a terminal application has enabled mouse tracking.
- On `/ghostty`, selections also follow output scrolling and pane resizing while their text remains intact. Overwrites, discarded edges, resets, and screen switches clear the selection. Preservation covers up to 1,000 rows and 1,048,576 UTF-16 units; selecting while an older frame is still displayed keeps ordinary browser behavior.
- Double-click words or paths and triple-click logical lines. On `/ghostty`, selection crosses confirmed soft wraps, including unmounted history; the built-in core stops at physical row boundaries. Hold Shift for live text when an application has enabled mouse reporting. Selection expands up to 1,000 rows and 1,048,576 UTF-16 units; oversized or pending frames keep browser behavior.
- Cmd+A or Ctrl+Shift+A selects all retained history and the active screen without mounting extra rows. Ctrl+A remains shell input. Wait for the selection highlight, then copy with Cmd+C, Ctrl+C, or Ctrl+Shift+C. Escape clears it. Select All preserves scrolling but clears on output, resizing, new input, pointer selection, or focus outside the terminal. Capture is capped at 16,777,216 UTF-16 units and never copies a partial result.
- Find searches the session's retained output, including history outside the mounted viewport. Open it with the Find button, Command+F, or Control+Shift+F; Control+F remains available to the shell. Enter and Shift+Enter navigate matches, Aa toggles case sensitivity, and Escape closes Find and returns focus to the terminal. Each session keeps its own query.
- The `/ghostty` route also matches across soft wraps and maps Unicode matches to whole terminal cells. Counts update as search progresses; a `+` means more than 10,000 matches, so narrow the query to see additional results. New output and resizing refresh results.

## Key Files

| File | Description |
|---|---|
| `server.ts` | Custom server with WebSocket ↔ PTY bridge |
| `app/page.tsx` | Built-in-core entry point |
| `app/ghostty/page.tsx` | Ghostty-core entry point with bounded Kitty image rendering |
| `app/session-workspace.tsx` | Sidebar, session tabs, Find controls, and terminal/WebSocket lifecycle |
| `app/output-reader.tsx` | Read-only output snapshots, refresh, cancellation, and dialog focus |
| `app/layout.tsx` | Root layout with metadata |

## Output reader checks

Run `pnpm --filter local build`, then `pnpm --filter local test:e2e` from the repository root. The browser suite starts an isolated production server and uses deterministic WebSocket output without spawning a shell. Chromium, Firefox, and WebKit cover unmounted history, native read-only navigation and Copy, explicit refresh, cancellation, and focus return. `app/output-reader.tsx` owns the dialog; `tests/output-reader.spec.ts` contains the browser cases.

## Output announcements

Each session has an **Announce output** checkbox, off by default. Enable it and
focus terminal input to receive polite screen-reader updates. Opening **Read
output**, switching sessions, or leaving input stops pending announcements;
returning does not replay background output. Updates summarize changed rows in
500 ms batches, with at most 20 rows or 4,000 characters between input actions.
A pause notice replaces oversized bursts; new input or toggling the checkbox
resumes announcements. Use **Read output** for a stable view of retained history.
