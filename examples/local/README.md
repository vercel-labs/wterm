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
- A new terminal attaches to a server session and spawns your default shell after its initial dimensions arrive
- A brief connection interruption resumes that same shell and existing browser terminal; missing output is replayed without repeating parsed bytes
- The browser sends sequenced JSON input, resize, and byte acknowledgment messages over WebSocket; the server acknowledges input handed to the PTY, relays raw PTY bytes in binary frames, and sends working-directory updates as JSON
- Terminal resizing, including browser pixel dimensions, is forwarded to the PTY via resize messages
- The server restores PTY pixel dimensions after each resize so Kitty clients such as `kitten icat` can detect image support
- Each sidebar tab keeps its terminal and shell session alive while other tabs are active
- Inactive tabs pause painting while continuing to consume output and answer terminal queries. Switching back paints the latest screen and retained history; hiding the browser document pauses painting for all tabs.
- **Read output** opens a stable snapshot of retained history and the active screen in a labelled, read-only text area. Use native keyboard navigation and Copy, **Refresh** to capture newer output, and **Close** or Escape to return to the opener. Output keeps running while the snapshot stays unchanged. A capture interrupted by output or resize can be retried; captures above 16,777,216 UTF-16 units fail without returning partial text. Closing cancels pending capture and releases the snapshot.
- The editable terminal input uses its session name for assistive technology; inactive sessions are excluded from page tab entry. Escape followed by Tab or Shift+Tab moves focus back to the page
- The `/ghostty` route uses the graphics-capable core and limits rendered Kitty images to 640×480 CSS pixels
- Auto-sized Kitty images align with the terminal content origin and reserve their rendered height visually so the following shell prompt appears below the image
- Each session displays its full current working directory in the sidebar, abbreviating the home directory as `~` and updating after `cd`
- Select terminal text and use the browser's normal Copy action. On `/ghostty`, wrapped commands copy without added newlines; explicit line breaks, whole Unicode cells, and block glyphs are preserved. Trailing padding is trimmed at fully selected hard row ends. Hold Shift to select when a terminal application has enabled mouse tracking.
- On `/ghostty`, native selections also follow output scrolling and pane resizing while their text remains intact. Overwrites, discarded edges, resets, and screen switches clear the selection. Preservation covers up to 1,000 rows and 1,048,576 UTF-16 units; selecting while an older frame is still displayed keeps ordinary browser behavior.
- Double-click words or paths and triple-click logical lines. On `/ghostty`, selection crosses confirmed soft wraps, including unmounted history; the built-in core stops at physical row boundaries. Hold Shift for live text when an application has enabled mouse reporting. Selection expands up to 1,000 rows and 1,048,576 UTF-16 units; oversized or pending frames keep browser behavior.
- Alt/Option-drag selects rectangular columns from logs or tables. Hold Shift+Alt inside mouse-reporting applications and drag beyond a vertical edge to scroll history. Copy preserves selected spaces, physical row breaks, and whole Unicode cells. Escape clears the rectangle, as do output, resizing, new input, or focus outside the terminal. See [rectangular selection](../../packages/@wterm/dom/README.md#rectangular-selection) for capture limits.
- Cmd+A or Ctrl+Shift+A selects all retained history and the active screen without mounting extra rows. Ctrl+A remains shell input. Wait for the selection highlight, then copy with Cmd+C, Ctrl+C, or Ctrl+Shift+C. Escape clears it. Select All preserves scrolling but clears on output, resizing, new input, pointer selection, or focus outside the terminal. Capture is capped at 16,777,216 UTF-16 units and never copies a partial result.
- Find searches the session's retained output, including history outside the mounted viewport. Open it with the Find button, Command+F, or Control+Shift+F; Control+F remains available to the shell. Enter and Shift+Enter navigate matches, Aa toggles case sensitivity, and Escape closes Find and returns focus to the terminal. Each session keeps its own query.
- The `/ghostty` route also matches across soft wraps and maps Unicode matches to whole terminal cells. Counts update as search progresses; a `+` means more than 10,000 matches, so narrow the query to see additional results. New output and resizing refresh results.

## Key Files

| File | Description |
|---|---|
| `server.ts` | Custom server with WebSocket ↔ PTY bridge |
| `lib/pty-output.ts` | Bounded output window and PTY pause/resume |
| `lib/terminal-sessions.ts` | Session ownership, attachment tokens, replay, and expiry |
| `lib/terminal-connection.ts` | Browser parsing tasks, acknowledgments, and bounded input |
| `lib/terminal-protocol.ts` | Shared message types and buffer limits |
| `app/page.tsx` | Built-in-core entry point |
| `app/ghostty/page.tsx` | Ghostty-core entry point with bounded Kitty image rendering |
| `app/session-workspace.tsx` | Sidebar, session tabs, Find controls, and terminal/WebSocket lifecycle |
| `app/output-reader.tsx` | Read-only output snapshots, refresh, cancellation, and dialog focus |
| `app/layout.tsx` | Root layout with metadata |

## Output flow control

Fast commands pause when the browser falls behind, then resume as it consumes
output. Each session allows up to 128 KiB or 256 output frames awaiting
acknowledgment, with frames no larger than 16 KiB. The server pauses PTY reads
at the limit and resumes below 32 KiB and 64 frames, after pending output drains.
Late PTY data is capped at 256 KiB and 1,024 queued chunks. Socket backlog also
pauses reads; exceeding a queue limit ends the session with a visible status.

The browser parses output in short tasks and acknowledges bytes only after
`WTerm.write()` returns. Acknowledgment does not wait for painting, so programs
using synchronized drawing can finish their updates. Binary framing preserves
UTF-8 and escape sequences split across messages. Normal process exit waits
for the final output to be consumed.

Input messages, including their JSON envelope, must fit within 64 KiB. The
browser caps both its socket send buffer and unacknowledged input at 64 KiB,
with at most 1,024 unacknowledged messages, including empty ones. Only message
lengths are retained for acknowledgment tracking; input text is not queued for
replay. A busy connection or oversized paste rejects the whole input event
and displays a message. Control messages have reserved space. Input is never
retried automatically.

Each input carries a sequence number. The server acknowledges the contiguous
prefix handed to the PTY and ignores repeated accepted numbers. Acknowledgment
means the PTY write returned successfully; it does not prove the shell read,
executed, or completed a command. A failed PTY write ends the session without
acknowledging uncertain input. Acknowledgments coalesce while the socket is
busy, and polling stops while detached.

## Reconnecting

After detecting a connection interruption, the existing page retries for up to
25 seconds. The workspace shows **Reconnecting…** and rejects input until the
session returns. The terminal keeps its parser, screens, history, and graphics;
the server replays only bytes after the terminal's last successfully parsed
offset, including bytes whose acknowledgments were lost. A replacement socket
owns input and resizing; callbacks from older sockets cannot affect the session.

Detached sessions pause PTY reads and expire after 30 seconds. Retained sent
output is limited to the existing 128 KiB/256-frame window; pending output
remains capped at 256 KiB/1,024 chunks. The server allows at most 32 live or
detached sessions. A shell that exits while detached can still deliver its final
output after reattachment within that interval.

Reattachment reports the last accepted input number, including when its original
acknowledgment was lost. Fully accepted input produces a simple **Reconnected.**
notice. If input did not reach the PTY, or was rejected while disconnected, the
workspace says it was not delivered or resent and asks you to check the command
line before continuing. After fencing the old socket, the connection discards
the unaccepted suffix and assigns new input numbers after the accepted prefix.
No input is resent automatically. If recovery fails before delivery can be
confirmed, the ended-session status preserves that uncertainty. The notice
remains until you dismiss it, and dismissing returns focus to terminal input.
Closing a connected session terminates its PTY and cancels pending work.
Closing while disconnected cancels
browser retries, and the server expires the detached PTY within 30 seconds.

Recovery requires the same browser terminal instance. Attachment tokens stay in
page memory and are never placed in URLs or browser storage. Refreshing or
recreating a terminal starts a new shell. Server restarts, expired sessions, and
unavailable output ranges end with a visible status instead of silently
replacing a shell. This example does not restore sessions across refreshes or
server restarts.

This protocol is specific to the local example. Its client and server must be
updated together; a bare `WebSocketTransport` client cannot connect directly.

## Checks

Run `pnpm --filter local test` for queue, acknowledgment, input, and teardown
checks. On macOS or Linux, this also streams 4 MiB through a real PTY and
WebSocket, stalls consumption, and verifies exact bytes after resuming. A second
real-PTY case disconnects during 2 MiB of output, loses an acknowledgment, then
verifies exact output, the original process identity, and explicit teardown.
A third real-PTY case loses an input acknowledgment and a later input message,
reattaches through the browser connection class, and verifies that accepted
input executes once, missing input is not replayed, and new input still works.

Run `pnpm --filter local build`, then `pnpm --filter local test:e2e` from the repository root. The browser suite starts an isolated production server and uses deterministic WebSocket output without spawning a shell. Chromium, Firefox, and WebKit cover streamed Unicode, synchronized drawing, input during output, buffer overflow, unmounted history, native read-only navigation and Copy, explicit refresh, cancellation, and focus return. Reconnection cases preserve partial UTF-8, alternate screens, synchronized drawing, terminal replies, and focus, reject disconnected input, and report an unavailable session.

## Output announcements

Each session has an **Announce output** checkbox, off by default. Enable it and
focus terminal input to receive polite screen-reader updates. Opening **Read
output**, switching sessions, or leaving input stops pending announcements;
returning does not replay background output. Updates summarize changed rows in
500 ms batches, with at most 20 rows or 4,000 characters between input actions.
A pause notice replaces oversized bursts; new input or toggling the checkbox
resumes announcements. Use **Read output** for a stable view of retained history.
