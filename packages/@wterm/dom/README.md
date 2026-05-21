# @wterm/dom

DOM renderer, input handler, and orchestrator for [wterm](https://github.com/vercel-labs/wterm) — a terminal emulator for the web. No framework required.

Re-exports everything from `@wterm/core`, so this is the only package you need for vanilla JS usage.

## Install

```bash
npm install @wterm/dom
```

## Usage

```html
<div id="terminal"></div>

<script type="module">
  import { WTerm } from "@wterm/dom";
  import "@wterm/dom/css";

  const term = new WTerm(document.getElementById("terminal"));
  await term.init();
</script>
```

The WASM binary is embedded in the package — no extra setup required. To serve it separately instead, pass `wasmUrl`.

## API

### `WTerm`

The main terminal class.

```ts
new WTerm(element: HTMLElement, options?: WTermOptions)
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `cols` | `number` | `80` | Initial column count |
| `rows` | `number` | `24` | Initial row count |
| `wasmUrl` | `string` | — | Optional URL to serve the WASM binary separately (embedded by default) |
| `autoResize` | `boolean` | `true` | Auto-resize based on container dimensions |
| `cursorBlink` | `boolean` | `false` | Enable cursor blinking animation |
| `debug` | `boolean` | `false` | Enable debug mode. Exposes a `DebugAdapter` on the instance (`wt.debug`) for inspecting escape sequences, cell data, render performance, and unhandled CSI sequences. |
| `images` | `boolean` | `true` | Enable inline image rendering via the [Kitty terminal graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/). When enabled, `\x1b_G…\x1b\\` APC sequences are intercepted and rendered as `<img>` overlays above the cell grid. Set to `false` to pass the bytes through to the core unchanged. |
| `onData` | `(data: string) => void` | — | Called when the terminal produces data (user input or host response). When omitted, input is echoed back automatically. |
| `onTitle` | `(title: string) => void` | — | Called when the terminal title changes |
| `onResize` | `(cols: number, rows: number) => void` | — | Called on resize |

**Methods:**

| Method | Description |
|---|---|
| `init(): Promise<WTerm>` | Load WASM and start rendering |
| `write(data: string \| Uint8Array)` | Write data to the terminal |
| `resize(cols, rows)` | Resize the terminal grid |
| `focus()` | Focus the terminal element |
| `destroy()` | Clean up event listeners and DOM |

### `WebSocketTransport`

Connect to a PTY backend over WebSocket (re-exported from `@wterm/core`).

```ts
import { WTerm, WebSocketTransport } from "@wterm/dom";

const term = new WTerm(el, { cols: 80, rows: 24 });
await term.init();

const ws = new WebSocketTransport({
  url: "ws://localhost:8080/pty",
  onData: (data) => term.write(data),
});

ws.connect();
term.onData = (data) => ws.send(data);
```

## Inline images (Kitty graphics protocol)

When `images: true` (default), wterm intercepts Kitty graphics protocol APC sequences and renders the transmitted PNG as an absolutely-positioned `<img>` overlay aligned to the cell grid. Supports inline base64 transfers (`f=100`) and multi-chunk `m=1`/`m=0` payloads. Actions: `t` (transmit), `T` (transmit + display), `p` (put placement), `d` (delete).

```ts
const png = new Uint8Array(
  await fetch("/icon.png").then((r) => r.arrayBuffer()),
);
const b64 = btoa(String.fromCharCode(...png));
term.write(`\x1b_Ga=T,f=100,i=1,c=20,r=5;${b64}\x1b\\`);
```

Not yet supported: raw RGB/RGBA frames (`f=24`/`f=32`), file/shared-memory transports, virtual-placement via Unicode placeholders, animations, Sixel, and iTerm2 inline images.

## Themes

Import the stylesheet and apply a theme class to the terminal element:

```js
import "@wterm/dom/css";
```

Built-in themes: `theme-solarized-dark`, `theme-monokai`, `theme-light`. Apply via class name:

```js
element.classList.add("theme-monokai");
```

All colors use CSS custom properties (`--term-fg`, `--term-bg`, `--term-color-0` through `--term-color-15`, etc.) so you can define your own theme with plain CSS.

## License

Apache-2.0
