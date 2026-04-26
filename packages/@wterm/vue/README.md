# @wterm/vue

Vue component for [wterm](https://github.com/vercel-labs/wterm) — a terminal emulator for the web.

## Install

```bash
npm install @wterm/dom @wterm/vue
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

By default, typed input is echoed back to the terminal. Listen to the `data` event when you need control over input:

```vue
<script setup lang="ts">
import { useTemplateRef } from "vue";
import { Terminal } from "@wterm/vue";
import "@wterm/vue/css";

const term = useTemplateRef("term");

function onData(chunk: string) {
  socket.send(chunk);
}
</script>

<template>
  <Terminal ref="term" @data="onData" />
</template>
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
| `debug` | `boolean` | `false` | Enable debug mode. Exposes a `DebugAdapter` on the underlying `WTerm` instance for inspecting escape sequences, cell data, render performance, and unhandled CSI sequences. |

Standard DOM attributes (`class`, `style`, `id`, ARIA props, etc.) are forwarded to the root `<div>` via `inheritAttrs`.

## Events

| Event | Payload | Description |
|---|---|---|
| `data` | `(data: string)` | Emitted when the terminal produces data (user input or host response). When no listener is attached, input is echoed back automatically. |
| `title` | `(title: string)` | Emitted when the terminal title changes via an escape sequence. |
| `resize` | `(cols: number, rows: number)` | Emitted after the terminal is resized. |
| `ready` | `(wt: WTerm)` | Emitted once after `WTerm.init()` resolves, carrying the underlying `WTerm` instance. |
| `error` | `(err: unknown)` | Emitted if WASM loading or initialization fails. |

## Template Ref

Access imperative methods via a template ref:

```vue
<script setup lang="ts">
import { useTemplateRef } from "vue";
import { Terminal, type WTerm } from "@wterm/vue";

const term = useTemplateRef("term");

function onReady(wt: WTerm) {
  wt.write("hello\r\n");
  term.value?.resize(120, 40);
}
</script>

<template>
  <Terminal ref="term" @ready="onReady" />
</template>
```

| Member | Type | Description |
|---|---|---|
| `write` | `(data: string \| Uint8Array) => void` | Write data to the terminal |
| `resize` | `(cols: number, rows: number) => void` | Resize the terminal |
| `focus` | `() => void` | Focus the terminal |
| `instance` | `WTerm \| null` | Underlying `WTerm` instance (`null` before mount) |

## Themes

Import the stylesheet to get the default theme and all built-in themes:

```vue
<script setup lang="ts">
import "@wterm/vue/css";
</script>
```

Switch themes via the `theme` prop:

```vue
<Terminal theme="monokai" />
```

Built-in: `solarized-dark`, `monokai`, `light`. Define custom themes with CSS custom properties.

## License

Apache-2.0
