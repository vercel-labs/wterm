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
| `maxImageWidth` | `number` | — | Maximum rendered Kitty image width in CSS pixels. Images larger than the limit are scaled down proportionally. |
| `maxImageHeight` | `number` | — | Maximum rendered Kitty image height in CSS pixels. Images larger than the limit are scaled down proportionally. |
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

WTerm implements the Kitty keyboard protocol when the active core exposes negotiated flags. The built-in and Ghostty cores support query, push, pop, set, OR, and NOT operations, with independent state for the primary and alternate screens. Cores without `kittyKeyboardFlags()` keep the legacy keyboard path unchanged.

Browser keyboard events do not expose every native field the protocol can carry. WTerm reports physical functional and modifier keys from `KeyboardEvent.code`, text from `KeyboardEvent.key`, and shifted alternates when available. It does not invent the base-layout alternate, cannot synthesize release events the browser never delivers, and limits associated text to the current press event.

WTerm honors synchronized output mode (CSI `?2026`) by painting the block atomically when the mode closes. Each synchronized block can hold rendering for at most one second from its opening sequence. Ordinary payload does not extend that deadline. If the deadline expires, WTerm resumes painting until a fresh synchronized block begins.

Ordinary writes schedule `requestAnimationFrame` directly. Multiple writes before the frame are coalesced into one render.

When a terminal core supplies `CellData.chars`, the renderer paints that complete grapheme string instead of only the cell's base code point.

When a core supplies OSC 8 metadata through `CellData.linkUri` and `CellData.linkKey`, the renderer groups the covered cells into native anchors. Only absolute HTTP and HTTPS URIs become clickable. Invalid, relative, and executable schemes render as ordinary terminal text.
While hovering an anchor, holding Command on macOS or Control on Windows and Linux reveals its underline and pointer cursor. Plain clicks remain terminal interaction. Command-click, Control-click, or native keyboard activation when an anchor receives focus opens the link. Modified link activation remains available while SGR mouse tracking is active and is not forwarded to the terminal application.

WTerm answers xterm/Kitty pixel geometry queries (`CSI 14 t` and `CSI 16 t`) from the rendered terminal element and forwards the reports through `onData`, so Kitty graphics clients can size and place images in the browser.

Scrollback normally keeps only the visible rows plus overscan mounted in the DOM. While native text selection is active, the selected range stays mounted so the browser can preserve it. Native browser find and accessibility inspect the mounted window, not every retained history row. Scrolling updates the window, while new output follows the exact bottom only when the terminal was already there.

WTerm owns scrollback anchoring when old history is discarded. The package stylesheet disables browser-native scroll anchoring on the terminal scroller so rollover produces one deterministic adjustment across browsers.

### Terminal images

The DOM renderer consumes the optional `TerminalCore.getGraphicsState()` and
`getGraphicsImage()` methods when both are present. It creates a separate,
absolute canvas overlay for visible pinned placements, using copied RGBA bytes
and the same retained-row coordinates as text and scrollback. Images are
pointer-transparent, non-focusable, and `aria-hidden`; terminal rows remain the
semantic surface for selection, copy, keyboard input, and screen readers.

The built-in core deliberately does not provide image data. Use
`@wterm/ghostty` for direct Kitty Graphics Protocol PNG/RGB/RGBA output. Image
state is transient and is isolated per primary/alternate screen. Replacement,
deletion, scrollback movement, resize, and screen changes invalidate the layer;
off-screen placements are not materialized, and canvases do not add scroll
height. Implicit Kitty placements (the common auto-sized form) align with the
terminal content origin and reserve their rendered height in the visual text
flow, so a prompt produced after an image appears under the image instead of
behind it.

Set `maxImageWidth` and/or `maxImageHeight` on `WTerm` to constrain rendered
image dimensions in CSS pixels; the image keeps its aspect ratio and is never
scaled up. These are display limits and do not reduce decoded image memory.

Image pixels are decorative until an accessible description contract exists.
Applications should provide equivalent textual context when image meaning is
important. Unsupported protocols and non-direct Kitty media are ignored safely.
The browser overlay caps each destination canvas to the active terminal's pixel
area and enforces a 32 MiB total backing-store budget, independently of the
Ghostty decoded-image budget; placements that do not fit are skipped.

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

### `PredictiveEcho`

Mosh-style client-side echo prediction. Paints printable ASCII to the
terminal at typing latency instead of waiting for the network round-trip,
then reconciles with the authoritative server stream as bytes arrive.
Predictions are disabled in alt-screen mode (vim, less, htop, ...).

```ts
import { WTerm, WebSocketTransport, PredictiveEcho } from "@wterm/dom";

const term = new WTerm(el);
const ws = new WebSocketTransport({ url: "wss://example.com/pty" });

const echo = new PredictiveEcho({
  term,
  send: (data) => ws.send(data),
});

term.onData = (data) => echo.handleInput(data);
ws.onData    = (data) => echo.handleServerData(data);

await term.init();
ws.connect();
```

Pass a custom `shouldPredict(data, term)` to override the default
(printable ASCII only, off in alt-screen).

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
