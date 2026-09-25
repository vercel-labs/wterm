# @wterm/core

Headless terminal emulator core for [wterm](https://github.com/vercel-labs/wterm). Provides the WASM bridge, the pluggable `TerminalCore` contract, and WebSocket transport — no DOM dependency.

## Related Packages

| Package | Description |
|---|---|
| [`@wterm/dom`](https://www.npmjs.com/package/@wterm/dom) | DOM renderer, input handler — vanilla JS terminal |
| [`@wterm/react`](https://www.npmjs.com/package/@wterm/react) | React component + `useTerminal` hook |
| [`@wterm/vue`](https://www.npmjs.com/package/@wterm/vue) | Vue 3 component + template ref API |
| [`@wterm/svelte`](https://www.npmjs.com/package/@wterm/svelte) | Svelte component + callback API |
| [`@wterm/ghostty`](https://www.npmjs.com/package/@wterm/ghostty) | Full-featured VT emulation core powered by libghostty |
| [`@wterm/just-bash`](https://www.npmjs.com/package/@wterm/just-bash) | In-browser Bash shell powered by just-bash |
| [`@wterm/markdown`](https://www.npmjs.com/package/@wterm/markdown) | Streaming Markdown-to-ANSI renderer for terminals |

## Install

```bash
npm install @wterm/core
```

## Pluggable Cores

`@wterm/core` defines a `TerminalCore` interface that any terminal emulation backend can implement. The built-in `WasmBridge` implements it using wterm's lightweight Zig WASM binary (~26 KB). For additional protocols and proper grapheme handling, use [`@wterm/ghostty`](https://www.npmjs.com/package/@wterm/ghostty), which implements the same interface using libghostty.

```ts
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";

// Default — uses built-in lightweight core
const term = new WTerm(el);

// Opt-in — uses libghostty for full VT emulation
const core = await GhosttyCore.load();
const term = new WTerm(el, { core });
```

## API

### `WasmBridge`

Low-level interface to the Zig/WASM terminal state machine. Implements the `TerminalCore` interface.

```ts
import { WasmBridge } from "@wterm/core";

const bridge = await WasmBridge.load();
bridge.init(80, 24);
bridge.writeString("Hello, world!\r\n");

const cell = bridge.getCell(0, 0); // { char, chars?, fg, bg, flags, width, linkUri?, linkId?, linkKey? }
const cursor = bridge.getCursor();  // { row, col, visible, shape, blinking }
```

| Method | Description |
|---|---|
| `WasmBridge.load(url?)` | Load WASM binary and return a new bridge instance. Uses the embedded binary when no URL is given. |
| `init(cols, rows)` | Initialize the terminal grid |
| `writeString(str, afterChunk?)` | Write a UTF-8 string, optionally running a callback after each internal chunk |
| `writeRaw(data, afterChunk?)` | Write raw bytes, optionally running a callback after each internal chunk |
| `resize(cols, rows)` | Resize the terminal grid |
| `getCell(row, col)` | Get cell data, including optional resolved OSC 8 metadata (`linkUri`, explicit `linkId`, and opaque `linkKey`) |
| `getCursor()` | Get cursor state (`{ row, col, visible, shape?, blinking? }`) |
| `getCols()` / `getRows()` | Get applied grid dimensions after initialization or resize. The built-in core clamps requests to 1–1024 columns and 1–512 rows. |
| `isDirtyRow(row)` | Check if a row needs re-rendering |
| `clearDirty()` | Reset all dirty-row flags |
| `getTitle()` | Get pending title change (or `null`) |
| `getBellCount()` | Read and clear the number of pending BEL controls; `0` when none |
| `getResponse()` | Get pending host response (or `null`) |
| `getResourceState()` | Get optional core resource state, including built-in hyperlink identity saturation |
| `getScrollbackCount()` | Number of lines in the scrollback buffer |
| `getScrollbackDiscardedCount()` | Cumulative rows discarded from the oldest end, when supported |
| `getScrollbackCell(offset, col)` | Get cell data from scrollback |
| `getScrollbackLineLen(offset)` | Get length of a scrollback line |
| `cursorKeysApp()` | Whether cursor keys are in application mode |
| `bracketedPaste()` | Whether bracketed paste mode is active |
| `usingAltScreen()` | Whether the alternate screen buffer is active |
| `mouseTracking()` | Active mouse tracking mode (`0`, `1000`, `1002`, or `1003`) |
| `mouseSgr()` | Whether cell-coordinate SGR mouse encoding (1006) is active |
| `mouseEncoding()` | Active mouse wire format (`x10`, `utf8`, `sgr`, `urxvt`, or `sgr-pixels`). The DOM layer handles all five; `sgr-pixels` reports 1-based CSS pixels. |
| `focusEvents()` | Whether focus reporting is active |
| `synchronizedOutput()` | Whether synchronized output mode (2026) is active |
| `synchronizedOutputGeneration()` | Monotonic generation for synchronized output blocks |
| `kittyKeyboardFlags()` | Active Kitty keyboard protocol flags |

OSC 8 hyperlink metadata is optional so third-party `TerminalCore` implementations remain source-compatible. Cores should expose the resolved URI and an opaque semantic key rather than a private numeric index.

Wide CJK, fullwidth, and emoji codepoints occupy a leading cell with `width: 2` and a continuation with `width: 0`. Character insertion (`ICH`) and deletion (`DCH`) shift the requested number of columns from the cursor, replacing split wide characters with background-colored spaces. With automatic wrapping disabled, a wide character that cannot fit at the right edge leaves the row unchanged. A one-column terminal consumes wide characters as spaces.

The built-in core supports ASCII (`B`), British (`A`), and DEC Special Graphics (`0`) designations for G0–G3. For example, `\x1b(0lqqk\x1b(B` produces `┌──┐`. SI/SO select G0/G1; `ESC n/o` select G2/G3, and `ESC N/O` select them for one character. Cursor save/restore preserves character-set state. Mapping affects ASCII characters only, so UTF-8 text remains intact.

`CursorState.shape` (`"block"`, `"bar"`, or `"underline"`) and `blinking` are
optional for custom cores. The built-in and Ghostty cores expose both fields
from DECSCUSR (`CSI Ps SP q`) and cursor blink mode (`CSI ? 12 h/l`). Missing
fields render as a steady block unless the host sets `cursorBlink`. Style 0
or an omitted parameter restores the default steady block; styles 1/2, 3/4,
and 5/6 select blinking/steady block, underline, and bar respectively.

`TerminalCore.kittyKeyboardFlags()` is also optional. The DOM input handler uses it to encode negotiated Kitty keyboard events; cores that omit it retain the existing legacy keyboard behavior.

The built-in core answers DEC private-mode status queries (`CSI ? Ps $ p`) through `getResponse()`. It reports `1` for set, `2` for reset, and `0` for unrecognized modes, including the current state of synchronized output (`?2026`), bracketed paste (`?2004`), mouse tracking and encoding, focus reporting, cursor modes, and alternate-screen modes. For example, `\x1b[?2026$p` receives `\x1b[?2026;2$y` until mode 2026 is enabled.

Primary device-attributes queries (`CSI c` or `CSI 0 c`) receive `\x1b[?1;2c` through `getResponse()`, identifying VT100 advanced-video support. Secondary and private variants receive no reply.

The built-in core reports its fixed hyperlink identity capacity through `getResourceState()`. When `hyperlinks.saturated` is true, new distinct OSC 8 links render as plain text and `hyperlinks.rejected` counts capacity-rejected opens. Existing identities remain valid.

### Optional terminal graphics

`TerminalCore` also has optional `getGraphicsState()` and `getGraphicsImage()` methods. A provider returns copied image metadata and tightly packed, row-major RGBA bytes for the active screen, plus pinned placements in retained-row coordinates. Rows are zero-based from the oldest retained row; a placement's `col`, `row`, and pixel offsets are measured from the top-left of that retained terminal surface. Image versions identify replacements, and a changed generation invalidates placement and image snapshots.

These methods are optional so existing custom cores and test doubles remain compatible. Missing, malformed, or unavailable graphics return `null` and must not interrupt ordinary terminal writes. Returned arrays and `Uint8Array` buffers are caller-owned copies.

The built-in lightweight core consumes unsupported 7-bit Kitty APC graphics sequences safely but does not advertise a graphics provider. Kitty graphics are currently rendered by the Ghostty backend only; Sixel, iTerm2, virtual Unicode placements, animation, and file/shared-memory/URL media are outside this release.

### `WebSocketTransport`

Connect to a PTY backend over WebSocket.

```ts
import { WebSocketTransport } from "@wterm/core";

const ws = new WebSocketTransport({
  url: "ws://localhost:8080/pty",
  onData: (data) => { /* handle received data */ },
});

ws.connect();
ws.send("ls\n");
```

## License

Apache-2.0
