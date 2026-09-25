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
| `cursorBlink` | `boolean` | Application-controlled | Force blinking on (`true`) or off (`false`); omit to follow the terminal (initially steady) |
| `debug` | `boolean` | `false` | Enable debug mode. Exposes a `DebugAdapter` on the instance (`wt.debug`) for inspecting escape sequences, cell data, render performance, and unhandled CSI sequences. |
| `onData` | `(data: string) => void` | — | Called when the terminal produces data (user input or host response). When omitted, input is echoed back automatically. |
| `onBinary` | `(data: Uint8Array) => void` | — | Called with raw X10 mouse bytes when supplied. Send the bytes unchanged to a binary-capable transport. |
| `onTitle` | `(title: string) => void` | — | Called when the terminal title changes |
| `onBell` | `(count: number) => void` | — | Called with the number of BEL controls since the last delivery |
| `onResize` | `(cols: number, rows: number) => void` | — | Called with the grid dimensions applied by the core after resize |

**Methods:**

| Method | Description |
|---|---|
| `init(): Promise<WTerm>` | Load WASM and start rendering |
| `write(data: string \| Uint8Array)` | Write data to the terminal |
| `resize(cols, rows)` | Resize the terminal grid |
| `focus()` | Focus the terminal element |
| `destroy()` | Clean up event listeners and DOM |

After `init()` or `resize()`, `term.cols` and `term.rows` reflect the grid size
the core actually uses. Use these values, or the values passed to `onResize`,
when sizing a connected PTY. The built-in core currently supports up to
1024 columns and 512 rows; larger requests are clamped to those limits.

When a terminal application enables mouse tracking (1000, 1002, or 1003), WTerm sends reports in the active encoding. UTF-8 (1005), SGR (1006), urxvt (1015), and SGR pixel (1016) reports reach `onData`; forward those strings through a UTF-8 transport. Mode 1016 reports 1-based CSS-pixel coordinates relative to the visible grid, independent of device pixel ratio. Mode 1003 reports unpressed pointer movement once per cell for cell formats and once per CSS pixel for 1016.

X10 reports use `onBinary` when supplied, so raw bytes reach a binary-capable transport unchanged. Without `onBinary`, ASCII-only X10 reports reach `onData`; coordinates requiring non-ASCII bytes are skipped rather than changed by UTF-8 encoding. X10 coordinates above 223 and UTF-8 coordinates above 2015 cannot be represented and are skipped. Shift retains native text selection. Focus reports reach `onData` when mode 1004 is active.

Mouse reports come from the live terminal grid. Clicks and wheel gestures over
scrollback rows stay with the browser, and wheel gestures keep scrolling history
until the terminal reaches the bottom. When mouse tracking is active, hold
Shift while scrolling to move through history from the live viewport. A drag
started in the live grid still reports its release if the pointer leaves it.

`onBell` runs as BEL output is written, including during synchronized output.
Several bells in one write chunk are delivered as one count. BEL used to end
an OSC sequence does not ring. WTerm does not play sound automatically; the
host chooses whether to play sound, show a visual alert, or ignore the event.

Both cores expose application-requested block, bar, and underline cursors through
`CursorState.shape` and blink mode through `CursorState.blinking`. The renderer
updates these independently of dirty text rows, preserves cell colors during
blink-off frames, and shows a steady outline when unfocused. Custom cores can
omit the new fields for the existing steady block fallback. `cursorBlink`
overrides blinking when explicitly set; shape always follows the core.

WTerm implements the Kitty keyboard protocol when the active core exposes negotiated flags. The built-in and Ghostty cores support query, push, pop, set, OR, and NOT operations, with independent state for the primary and alternate screens. Cores without `kittyKeyboardFlags()` keep the legacy keyboard path unchanged.

When the browser identifies a printable AltGr key, WTerm lets its committed character pass through native text input even in Kitty keyboard mode. This also covers Control+Alt text typed with the right Alt key when the browser does not expose AltGraph state. Control+Alt chords without either AltGr signal retain their Kitty encoding.

Without Kitty keyboard negotiation, Shift, Alt, and Control modifiers on arrow,
Home/End, Insert/Delete, Page Up/Down, and F1–F12 keys use xterm-style CSI
sequences. Unmodified application cursor keys still use SS3 when the core
requests application mode. Browser-reserved shortcuts may never reach WTerm.

Without Kitty keyboard negotiation, Control+Space sends NUL, Control+/ sends
US, and Control+Backspace sends BS. Control+Alt printable input stays on the
native text path in this mode so keyboard layouts using AltGr can enter
characters.

Browser keyboard events do not expose every native field the protocol can carry. WTerm reports physical functional and modifier keys from `KeyboardEvent.code`, text from `KeyboardEvent.key`, and shifted alternates when available. It does not invent the base-layout alternate, cannot synthesize release events the browser never delivers, and limits associated text to the current press event.

During IME composition, tentative text appears at the terminal cursor in the
browser's input field. The connected application receives only the committed
text. When composition starts while reading scrollback, WTerm returns to the
live viewport so the text and candidate window stay near the cursor.

On touch-first devices, the transparent input target stays at the terminal
cursor so tapping can open the soft keyboard and native paste menu. Holding
Backspace continues deleting through repeated browser input events. Paste
still follows the application's bracketed-paste mode when enabled.

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

Use a monospace font through `--term-font-family`. Cells use its measured width,
so braille, box drawing, and other fallback glyphs cannot push later columns out
of alignment. Wide characters occupy two cells, and oversized glyphs are clipped
to their cells. Widths update when fonts load or the font size changes, including
with `autoResize: false`. Unicode text remains selectable and OSC 8 links keep
their text together.

Common light, heavy, and rounded box-drawing characters keep their strokes
connected across cell edges even when the selected font leaves gaps. The
characters remain selectable and copy as text.

Colored and reversed cells keep their backgrounds within their columns, including
the last column and rows in scrollback. A complete row with one shared, opaque
background extends that color to the container's right edge, so full-width
status bars stay filled. Mixed, dim, or hidden cells do not change the background
behind neighboring cells or other rows.

## License

Apache-2.0
