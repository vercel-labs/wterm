# @wterm/core

Headless terminal emulator core for [wterm](https://github.com/vercel-labs/wterm). Provides the WASM bridge and WebSocket transport — no DOM dependency.

## Related Packages

| Package | Description |
|---|---|
| [`@wterm/dom`](https://www.npmjs.com/package/@wterm/dom) | DOM renderer, input handler — vanilla JS terminal |
| [`@wterm/react`](https://www.npmjs.com/package/@wterm/react) | React component + `useTerminal` hook |
| [`@wterm/vue`](https://www.npmjs.com/package/@wterm/vue) | Vue 3 component + template ref API |
| [`@wterm/just-bash`](https://www.npmjs.com/package/@wterm/just-bash) | In-browser Bash shell powered by just-bash |
| [`@wterm/markdown`](https://www.npmjs.com/package/@wterm/markdown) | Streaming Markdown-to-ANSI renderer for terminals |

## Install

```bash
npm install @wterm/core
```

## API

### `WasmBridge`

Low-level interface to the Zig/WASM terminal state machine.

```ts
import { WasmBridge } from "@wterm/core";

const bridge = await WasmBridge.load();
bridge.init(80, 24);
bridge.writeString("Hello, world!\r\n");

const cell = bridge.getCell(0, 0); // { char, fg, bg, flags }
const cursor = bridge.getCursor();  // { row, col, visible }
```

| Method | Description |
|---|---|
| `WasmBridge.load(url?)` | Load WASM binary and return a new bridge instance. Uses the embedded binary when no URL is given. |
| `init(cols, rows)` | Initialize the terminal grid |
| `writeString(str)` | Write a UTF-8 string to the terminal |
| `writeRaw(data: Uint8Array)` | Write raw bytes to the terminal |
| `resize(cols, rows)` | Resize the terminal grid |
| `getCell(row, col)` | Get cell data (`{ char, fg, bg, flags }`) |
| `getCursor()` | Get cursor state (`{ row, col, visible }`) |
| `getCols()` / `getRows()` | Get current grid dimensions |
| `isDirtyRow(row)` | Check if a row needs re-rendering |
| `clearDirty()` | Reset all dirty-row flags |
| `getTitle()` | Get pending title change (or `null`) |
| `getResponse()` | Get pending host response (or `null`) |
| `getScrollbackCount()` | Number of lines in the scrollback buffer |
| `getScrollbackCell(offset, col)` | Get cell data from scrollback |
| `getScrollbackLineLen(offset)` | Get length of a scrollback line |
| `cursorKeysApp()` | Whether cursor keys are in application mode |
| `bracketedPaste()` | Whether bracketed paste mode is active |
| `usingAltScreen()` | Whether the alternate screen buffer is active |

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
