# Local Shell Example

Full local terminal in the browser, connected to your machine's shell via WebSocket and [node-pty](https://github.com/microsoft/node-pty). Use the left sidebar to create, switch between, and close independent shell sessions, and split the workspace to view up to four shells at once.

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
- Reloading restores split layouts, divider positions, zoom, and the focused terminal, and resumes saved shells while complete recovery records and server sessions remain available
- The browser sends sequenced JSON input, resize, and byte acknowledgment messages over WebSocket; the server acknowledges input handed to the PTY, relays raw PTY bytes in binary frames, and sends working-directory updates as JSON
- Terminal resizing, including browser pixel dimensions, is forwarded to the PTY via resize messages
- The server restores PTY pixel dimensions after each resize so Kitty clients such as `kitten icat` can detect image support
- Each sidebar tab keeps its terminal and shell session alive while other tabs are active
- Sessions outside the visible layout pause painting while continuing to consume output and answer terminal queries. Switching back paints the latest screen and retained history; hiding the browser document pauses painting for all tabs.
- **Read output** opens a stable snapshot of retained history and the active screen in a labelled, read-only text area. Use native keyboard navigation and Copy, **Refresh** to capture newer output, and **Close** or Escape to return to the opener. Output keeps running while the snapshot stays unchanged. A capture interrupted by output or resize can be retried; captures above 16,777,216 UTF-16 units fail without returning partial text. Closing cancels pending capture and releases the snapshot.
- The editable terminal input uses its session name for assistive technology; hidden sessions are excluded from page tab entry. Escape followed by Tab or Shift+Tab moves focus back to the page
- On `/ghostty`, an application clipboard-write request shows **Review clipboard request** and **Dismiss** without taking focus. Review opens a fixed, read-only preview; **Copy** (or **Clear clipboard** for empty text) writes only after you click it. New requests do not change an open preview. If the browser denies access, use native Copy from the text field. Clipboard reads are unsupported. Each session retains only its latest pending request, up to 65,536 UTF-8 bytes.
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
| `lib/pty-output-queue.mts` | Bounded byte queue and small-read batching shared with the PTY input harness |
| `lib/terminal-sessions.ts` | Session ownership, attachment tokens, replay, and expiry |
| `lib/session-recovery.ts` | Bounded tab-scoped output, resize, and theme replay records |
| `lib/terminal-connection.ts` | Browser parsing tasks, acknowledgments, and bounded input |
| `lib/terminal-protocol.ts` | Shared message types and buffer limits |
| `app/page.tsx` | Built-in-core entry point |
| `app/ghostty/page.tsx` | Ghostty-core entry point with bounded Kitty image rendering |
| `app/session-workspace.tsx` | Sidebar, split panes, Find controls, and terminal/WebSocket lifecycle |
| `app/appearance-settings.tsx` | Appearance dialog, OS changes, and browser persistence |
| `lib/appearance.ts` | Validated preferences and terminal colors |
| `app/shortcut-settings.tsx` | Shortcut editor, browser persistence, and cross-tab updates |
| `lib/shortcuts.ts` | Command defaults, binding validation, matching, and labels |
| `app/pane-divider.tsx` | Pointer and keyboard pane resizing |
| `lib/workspace-layout.ts` | Session selection, split geometry, and directional focus |
| `lib/workspace-persistence.ts` | Bounded layout decoding, session-reference checks, and saved arrangement format |
| `app/clipboard-request.tsx` | Application clipboard request review and explicit Copy |
| `app/output-reader.tsx` | Read-only output snapshots, refresh, cancellation, and dialog focus |
| `app/layout.tsx` | Root layout with metadata |

## Split panes

Use **Split right** or **Split down** in a pane header to open a new shell beside
or below it. Splits can be nested, with up to four panes visible. Each visible
pane keeps painting output; keyboard input goes only to the focused terminal.
Click a terminal or its header to focus it. From terminal input, use
Command+Option+arrow keys on macOS or Control+Alt+arrow keys to focus a pane in
that direction. These shortcuts do not take over Find or dialog text fields.

Drag a divider to resize. Dividers also accept keyboard focus: use the arrow
keys along their axis to adjust, Home/End for the available bounds, and Enter
to center. Each pane keeps at least 320×220 CSS pixels; smaller windows scroll
the workspace instead of collapsing panes. The shell receives the pane's
updated terminal and pixel dimensions.

Selecting a visible session in the sidebar focuses it. Selecting a hidden
session, or using **New terminal session**, replaces the focused pane while
keeping its previous shell open. **Zoom pane** temporarily shows one pane;
**Restore panes** brings back the split layout and divider positions. Close a
session using its sidebar close button; its neighbor fills the freed space,
and other shells keep running. Layout changes preserve terminal instances,
history, Find queries, and connections. Reloading restores nested splits,
divider proportions, the focused terminal, and zoom, including the arrangement
behind a zoomed pane. Hidden sessions remain in the sidebar. Smaller windows
keep the same arrangement with minimum pane sizes and workspace scrolling.
Find queries are not restored.

Layout is saved in this tab's `sessionStorage`, separately for each engine route.
It is checked against the saved session list: missing, stale, or damaged layouts
fall back to one pane with the first session selected, leaving the other sessions
in the sidebar. Closed sessions stay closed. A layout storage failure shows a
status and leaves live terminals and their replay records available. Ordinary
navigation or a new tab starts a fresh workspace; layout recovery uses the same
session limits described below.

## Shell command indicators

On `/ghostty`, shells that emit OSC 133 show **Ready**, **Running**, **Done**, or
**Exit N** in their sidebar entry and pane header. A reported result remains
visible through prompt redraws until the next command starts. Hidden sessions
keep updating without taking focus. Indicators disappear while disconnected,
after terminal reset, and for sessions whose shell does not emit markers.
The built-in `/` route has no shell-state indicator.

These labels use shell-reported state; they are separate from connection or PTY
exit status. Multiple markers in one parser chunk coalesce into the latest
state. The workspace does not install or overwrite shell configuration. Enable
OSC 133 in your shell integration; see [Shell integration](https://wterm.dev/configuration#shell-integration)
for the marker contract and a minimal zsh setup.

Participating sessions also show **Previous prompt** and **Next prompt** controls.
They jump from the top of the viewport through retained command prompts,
including unmounted history and multiline prompts. Navigation stops at either
end and is inactive in full-screen alternate-screen applications. It preserves
selection. Assign the two commands in **Keyboard shortcuts**; both start
unassigned to preserve existing bindings. Assigned navigation keys are consumed
by the workspace. Applications requesting physical modifier-key reports still
receive those reports without scrolling the viewport back to the bottom.

## Keyboard shortcuts

Open **Keyboard shortcuts** at the bottom of the sidebar to inspect or customize
bindings for new/close session, split right/down, zoom/restore, directional pane
focus, Find, and previous/next prompt. **Change** records one combination and replaces that command's
existing bindings. Use Control or Command with a letter, number, navigation key,
or function key. Bindings use physical key positions. Escape cancels recording;
press Escape again or **Close** to close the dialog and return to its opener.
Tab leaves recording and moves through the controls normally.

Defaults are Command+F or Control+Shift+F for Find, and Command+Option+arrows or
Control+Alt+arrows for pane focus. Other commands start unassigned. **Clear**
disables a command's shortcuts; **Reset defaults** restores the defaults.
Conflicting assignments are rejected. Common browser navigation, clipboard,
and shell interruption combinations are reserved; Control+Alt text keys are
reserved for AltGr. Some OS/browser combinations never reach the page.

Commands work from terminal input. Find and New terminal session also work from
workspace buttons. Shortcuts leave Find fields, other editable controls, open
dialogs, composition, and AltGr alone. An assigned shortcut is consumed even
when a pane limit prevents its action; holding it does not repeat the action or
send the shortcut key to a shell. Closing the last session focuses the new
session button. The close command terminates the current shell, just like its
sidebar close button.

Settings apply immediately, persist across reloads, and synchronize between tabs
and both engine routes on the same origin. Invalid or conflicting saved settings
fall back to defaults. If storage is unavailable, changes remain usable for the
current page and the dialog reports that they could not be saved. These are
workspace preferences, separate from the session recovery records described below.

## Appearance

Open **Appearance** at the bottom of the sidebar to choose **System**, **Dark**,
or **Light**, and a terminal font size from 10 to 32 px. Changes apply to existing,
hidden, and new panes without restarting shells or clearing output. Font changes
resize the terminal grid and report its new dimensions to the PTY. **System**
follows OS appearance changes; **Reset defaults** restores System and 14 px.
Closing the dialog or pressing Escape returns focus to its opener.

Appearance is saved in browser local storage and shared by both engine routes
and other tabs on the same origin. Invalid saved values fall back to defaults.
If browser storage is unavailable, changes still work for the current page and
the dialog reports that they could not be saved. Only theme and font size are
stored; terminal output, session credentials, and layout are not preferences.
Refreshing still starts a new shell.

Ghostty uses `WTerm.setThemeColors()` to update engine defaults and CSS together.
Theme changes do not inject bytes into the output stream or reset application
color overrides. Existing indexed-color output is repainted, including history.

## Output flow control

Fast commands pause when the browser falls behind, then resume as it consumes
output. Each session allows up to 128 KiB or 256 output frames awaiting
acknowledgment, with frames no larger than 16 KiB. The server pauses PTY reads
at the limit and resumes below 32 KiB and 64 frames, after pending output drains.
Late PTY data is capped at 256 KiB and 1,024 queued chunks. Socket backlog also
pauses reads; exceeding a queue limit ends the session with a visible status.

Adjacent small PTY reads share a frame instead of sending a WebSocket message
for each read. A full 16 KiB frame is eligible to send immediately; smaller
batches use a four-millisecond timer from the first read. Later reads and ACKs
do not extend that timer or flush it early. Event-loop delays or exhausted
credit can postpone delivery further. This reduces message overhead during
busy output while adding a small collection delay to isolated output.
Collecting bytes count toward the same pending limits. Detach retains them
without a running timer, reattach sends replay before pending bytes, normal
exit flushes the final batch, and explicit close discards it.

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

Reload recovery stores output bytes, every applied resize and host theme change,
attachment credentials, and input sequence counters in this tab's
`sessionStorage`, separately for each engine route. Credentials are never placed
in URLs. Terminal output can contain sensitive information, including echoed
commands. Closing a session removes its records; closing the browser tab removes
the tab's storage. A normal navigation or duplicated tab starts independently.

A new terminal replays the complete saved prefix from its initial dimensions,
preserving modes, both screens, history, graphics, and unfinished parser input.
Historical terminal replies and clipboard requests are not sent again. The
connection then resumes the same PTY from the saved byte offset, with existing
input acknowledgment and deduplication behavior. Output is saved before its
acknowledgment permits the server to discard it. Input text is never retried.

Records are limited to 1 MiB of output and 4,096 events per session, and browser
storage quotas also apply. Reaching a limit or a storage failure disables refresh
recovery for that session and shows a status while the live terminal continues.
Incomplete or invalid records, expired sessions, unavailable output ranges, and
server restarts produce an explicit failure instead of starting a replacement
shell. Reload must reattach within the existing 30-second server grace period.
This is bounded replay from session start, not an unlimited terminal checkpoint
or PTY survival across server restarts.

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
