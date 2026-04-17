# @wterm/vue

Vue 3 component for [wterm](https://github.com/vercel-labs/wterm) — a terminal emulator for the web.

## Install

```bash
npm install @wterm/dom @wterm/vue vue
```

## Usage

```vue
<script setup lang="ts">
import { Terminal } from "@wterm/vue";
import "@wterm/vue/css";
</script>

<template>
  <Terminal />
</template>
```

The WASM binary is embedded in the package — no extra setup required. To serve it separately instead, pass `wasmUrl`.

## `<Terminal>` Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `cols` | `number` | `80` | Initial column count |
| `rows` | `number` | `24` | Initial row count |
| `wasmUrl` | `string` | — | Optional URL to serve the WASM binary separately |
| `theme` | `string` | — | Theme name (for example `"solarized-dark"`, `"monokai"`, `"light"`) |
| `autoResize` | `boolean` | `false` | Auto-resize based on container dimensions |
| `cursorBlink` | `boolean` | `false` | Enable cursor blinking animation |
| `onData` | `(data: string) => void` | — | Called when the terminal produces data |
| `onTitle` | `(title: string) => void` | — | Called when the terminal title changes |
| `onResize` | `(cols: number, rows: number) => void` | — | Called on resize |
| `onReady` | `(wt: WTerm) => void` | — | Called after WASM loads and initialization completes |
| `onError` | `(error: unknown) => void` | — | Called if initialization fails |

Additional attributes (`class`, `style`, `id`, `data-*`, etc.) are forwarded to the root `div`.

## `useTerminal`

Returns an imperative handle ref plus helpers:

```vue
<script setup lang="ts">
import { Terminal, useTerminal } from "@wterm/vue";
import "@wterm/vue/css";

const terminal = useTerminal();
</script>

<template>
  <Terminal :ref="terminal.attach" />
</template>
```

| Return | Type | Description |
|---|---|---|
| `ref` | `ShallowRef<TerminalHandle \| null>` | Current imperative terminal handle |
| `attach` | `(instance: TerminalHandle \| null) => void` | Function ref to pass to `<Terminal>` |
| `write` | `(data: string \| Uint8Array) => void` | Write data to the terminal |
| `resize` | `(cols: number, rows: number) => void` | Resize the terminal |
| `focus` | `() => void` | Focus the terminal |

## `TerminalHandle`

The exposed imperative handle:

```ts
interface TerminalHandle {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  readonly instance: WTerm | null;
}
```

## Themes

Import the stylesheet to get the default theme and built-in themes:

```ts
import "@wterm/vue/css";
```

Switch themes via the `theme` prop:

```vue
<Terminal theme="monokai" />
```

Built-in: `solarized-dark`, `monokai`, `light`. Define custom themes with CSS custom properties.

## License

Apache-2.0
