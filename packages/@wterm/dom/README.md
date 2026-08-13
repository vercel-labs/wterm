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

When a terminal application enables modes 1000 or 1002 with SGR encoding (1006), pointer input is sent through `onData`. Focus reports are sent when mode 1004 is active.

WTerm honors synchronized output mode (CSI `?2026`) by painting the block atomically when the mode closes. Each synchronized block can hold rendering for at most one second from its opening sequence. Ordinary payload does not extend that deadline. If the deadline expires, WTerm resumes painting until a fresh synchronized block begins.

Ordinary writes schedule `requestAnimationFrame` directly. Multiple writes before the frame are coalesced into one render.

When a terminal core supplies `CellData.chars`, the renderer paints that complete grapheme string instead of only the cell's base code point.

When a core supplies OSC 8 metadata through `CellData.linkUri` and `CellData.linkKey`, the renderer groups the covered cells into native anchors. Only absolute HTTP and HTTPS URIs become clickable. Invalid, relative, and executable schemes render as ordinary terminal text.
While hovering an anchor, holding Command on macOS or Control on Windows and Linux reveals its underline and pointer cursor. Plain clicks remain terminal interaction. Command-click, Control-click, or native keyboard activation when an anchor receives focus opens the link. Modified link activation remains available while SGR mouse tracking is active and is not forwarded to the terminal application.

Scrollback normally keeps only the visible rows plus overscan mounted in the DOM. While native text selection is active, the selected range stays mounted so the browser can preserve it. Native browser find and accessibility inspect the mounted window, not every retained history row. Scrolling updates the window, while new output follows the exact bottom only when the terminal was already there.

WTerm owns scrollback anchoring when old history is discarded. The package stylesheet disables browser-native scroll anchoring on the terminal scroller so rollover produces one deterministic adjustment across browsers.

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
