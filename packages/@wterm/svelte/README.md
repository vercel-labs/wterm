# @wterm/svelte

Svelte action and controller for [wterm](https://github.com/vercel-labs/wterm) — a terminal emulator for the web.

## Install

```bash
npm install @wterm/dom @wterm/svelte svelte
```

## Usage

```svelte
<script lang="ts">
  import { wterm } from "@wterm/svelte";
  import "@wterm/svelte/css";
</script>

<div use:wterm />
```

The WASM binary is embedded in the package — no extra setup required. To serve it separately instead, pass `wasmUrl`.

## `wterm` Action Options

| Option | Type | Default | Description |
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
| `controller` | `TerminalController` | — | Optional imperative controller |

## `createTerminalController`

Create a controller when you want to write to or focus the terminal from other parts of your component:

```svelte
<script lang="ts">
  import { createTerminalController, wterm } from "@wterm/svelte";

  const terminal = createTerminalController();
</script>

<div use:wterm={{ controller: terminal }}></div>
<button onclick={() => terminal.focus()}>Focus</button>
```

| Method | Description |
|---|---|
| `write(data)` | Write data to the terminal |
| `resize(cols, rows)` | Resize the terminal |
| `focus()` | Focus the terminal |
| `instance` | Read-only access to the underlying `WTerm` instance |

## Themes

Import the stylesheet to get the default theme and built-in themes:

```ts
import "@wterm/svelte/css";
```

Switch themes through the action options:

```svelte
<div use:wterm={{ theme: "monokai" }}></div>
```

Built-in: `solarized-dark`, `monokai`, `light`. Define custom themes with CSS custom properties.

## License

Apache-2.0
