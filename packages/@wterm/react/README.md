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
| `cursorBlink` | `boolean` | `false` | Enable cursor blinking animation |
| `onData` | `(data: string) => void` | — | Called when the terminal produces data (user input or host response). When omitted, input is echoed back automatically. |
| `onTitle` | `(title: string) => void` | — | Called when the terminal title changes |
| `onResize` | `(cols: number, rows: number) => void` | — | Called on resize |
| `onReady` | `(wt: WTerm) => void` | — | Called after WASM is loaded and the terminal is initialized |

Standard `div` props (`className`, `style`, `id`, etc.) are forwarded to the container element.

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

## License

Apache-2.0
