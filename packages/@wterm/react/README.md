# @wterm/react

React component for [wterm](https://github.com/vercel-labs/wterm) — a terminal emulator for the web.

## Install

```bash
npm install @wterm/dom @wterm/react
```

## Usage

```tsx
import { Terminal } from "@wterm/react";
import "@wterm/react/css";

function App() {
  return <Terminal />;
}
```

By default, typed input is echoed back to the terminal. Use `onData` with `useTerminal` when you need control over input:

```tsx
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";

function App() {
  const { ref, write } = useTerminal();

  return (
    <Terminal
      ref={ref}
      onData={(data) => {
        socket.send(data);
      }}
    />
  );
}
```

The WASM binary is embedded in the package — no extra setup required. To serve it separately instead, pass `wasmUrl`.

## `<Terminal>` Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `cols` | `number` | `80` | Initial column count |
| `rows` | `number` | `24` | Initial row count |
| `wasmUrl` | `string` | — | Optional URL to serve the WASM binary separately (embedded by default) |
| `theme` | `string` | — | Theme name (e.g. `"solarized-dark"`, `"monokai"`, `"light"`) |
| `autoResize` | `boolean` | `false` | Auto-resize based on container dimensions |
| `maxImageWidth` | `number` | — | Maximum rendered Kitty image width in CSS pixels; images scale down proportionally |
| `maxImageHeight` | `number` | — | Maximum rendered Kitty image height in CSS pixels; images scale down proportionally |
| `cursorBlink` | `boolean` | Application-controlled | Force blinking on (`true`) or off (`false`); omit to follow the terminal (initially steady) |
| `debug` | `boolean` | `false` | Enable debug mode. Exposes a `DebugAdapter` on the underlying `WTerm` instance for inspecting escape sequences, cell data, render performance, and unhandled CSI sequences. |
| `onData` | `(data: string) => void` | — | Called when the terminal produces data (user input or host response). When omitted, input is echoed back automatically. |
| `onBinary` | `(data: Uint8Array) => void` | — | Called with raw X10 mouse reports for a binary-capable transport. Without it, only ASCII-safe X10 reports reach `onData`. |
| `onTitle` | `(title: string) => void` | — | Called when the terminal title changes |
| `onBell` | `(count: number) => void` | — | Called with pending BEL count as output is written; the host controls any alert |
| `onResize` | `(cols: number, rows: number) => void` | — | Called after resize with the grid dimensions applied by the core |
| `onReady` | `(wt: WTerm) => void` | — | Called after WASM is loaded and the terminal is initialized; `wt.cols` and `wt.rows` report its applied grid size |

Standard `div` props (`className`, `style`, `id`, etc.) are forwarded to the container element.

The component delegates rendering to `@wterm/dom`, so passing a graphics-capable
core such as `@wterm/ghostty` renders direct Kitty PNG/RGB/RGBA output. Use
`maxImageWidth` and/or `maxImageHeight` to constrain oversized images while
preserving their aspect ratio. Image canvases are decorative and
`aria-hidden`; they are pointer-transparent and never replace the text rows.

## `useTerminal` Hook

Returns a ref and imperative helpers for controlling the terminal:

```tsx
const { ref, write, resize, focus } = useTerminal();
```

| Return | Type | Description |
|---|---|---|
| `ref` | `React.RefObject<TerminalHandle>` | Pass to `<Terminal ref={ref}>` |
| `write` | `(data: string \| Uint8Array) => void` | Write data to the terminal |
| `resize` | `(cols: number, rows: number) => void` | Resize the terminal |
| `focus` | `() => void` | Focus the terminal |

## `TerminalHandle`

The imperative handle exposed via `ref`:

```ts
interface TerminalHandle {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  readonly instance: WTerm | null;
}
```

## Themes

Import the stylesheet to get the default theme and all built-in themes:

```tsx
import "@wterm/react/css";
```

Switch themes via the `theme` prop:

```tsx
<Terminal theme="monokai" />
```

Built-in: `solarized-dark`, `monokai`, `light`. Define custom themes with CSS custom properties.

## Selection and copy

Native Copy uses terminal line and cell semantics, joining Ghostty soft wraps while preserving explicit newlines and complete Unicode cells. Call `getSelectionText()` on the underlying WTerm instance to read the same text without accessing the clipboard. It returns `null` when no supported terminal selection exists. See [selection behavior and limits](../dom/README.md#selecting-and-copying-text).

With the current Ghostty WASM binary, selections follow output scrolling and resize/reflow while their text remains intact. Overwritten or discarded text, resets, and screen switches clear the selection. The linked reference describes preservation limits and pending-frame behavior.

Use `await instance.selectAll()` to select all retained history and the active screen, then read `instance.getSelectionText()`. Cmd+A or Ctrl+Shift+A invokes the same action while terminal input is focused. Capture is cancellable and bounded; output or resize clears it. Call `instance.clearSelection()` to cancel. See the linked selection reference for limits and copy shortcuts.

Double-click words or paths and triple-click logical lines. Use `instance.selectWord({ row, col })` or `instance.selectLine(row)` for the same selection from host controls; coordinates start at the oldest retained row. Ghostty joins confirmed soft wraps, including unmounted history. See the linked selection reference for boundaries, limits, and mouse-reporting behavior.

## Terminal search

Use the underlying `WTerm` instance to call `search(query, { caseSensitive })`, `findNext()`, `findPrevious()`, `getSearchState()`, and `clearSearch()`. Set its `onSearchChange` callback to update your Find controls. Access the instance through `onReady` or `ref.current.instance`. Search includes unmounted retained history; Ghostty also joins soft wraps. See the [search semantics and limits](../dom/README.md#terminal-search).

## License

Apache-2.0
