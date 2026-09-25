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

## Input accessibility

The terminal's input is a native multiline textbox named **Terminal** by default. Set `aria-label`, `aria-labelledby`, `aria-describedby`, or `aria-description` on the host element to name or describe that input. Changes stay synchronized; referenced labels and descriptions use the browser's normal ARIA precedence. For example:

```html
<h2 id="shell-heading">Build shell</h2>
<p id="shell-help">Commands run in the selected session.</p>
<div id="terminal" aria-labelledby="shell-heading" aria-describedby="shell-help"></div>
```

After initialization, the host defaults to `role="group"`; the textarea is the editable control. If you previously assigned `role="textbox"` and `aria-multiline` to the host yourself, remove those attributes or use `role="group"`. Explicit host roles are otherwise preserved. Do not hide the input from assistive technology.

Host `tabindex` applies to the input: `0` enables normal page tab entry and `-1` removes that tab stop. When supplied, WTerm sets the host itself to `-1` to avoid a duplicate stop and restores the latest requested value on destruction. Without `tabindex`, the input uses `0`. Use `term.focus()` for programmatic focus. Tab and Shift+Tab inside input still go to the terminal application for completion/navigation. Label and tab-order changes do not move focus.

Mounted output remains readable separately from input. This does not enable output announcements or expose unmounted history to screen readers. Ancestor `aria-hidden` and `inert` still control whether a terminal is available.

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
| `onSearchChange` | `(state: SearchState) => void` | — | Receives search progress, count, and active match changes |

**Methods:**

| Method | Description |
|---|---|
| `init(): Promise<WTerm>` | Load WASM and start rendering |
| `write(data: string \| Uint8Array)` | Write data to the terminal |
| `resize(cols, rows)` | Resize the terminal grid |
| `focus()` | Focus the terminal element |
| `search(query, { caseSensitive? })` | Start plain-text search over retained history and the active screen |
| `findNext()` / `findPrevious()` | Select and reveal a match, wrapping at either end; return false if there are none |
| `getSearchState()` | Get query, caseSensitive, count, activeIndex, searching, and limited |
| `getSelectionText(): string \| null` | Read the native selection with terminal line and cell semantics; returns null when unavailable |
| `selectWord({ row, col }): boolean` | Select a word at a retained-buffer cell, including confirmed soft wraps |
| `selectLine(row): boolean` | Select the complete logical line containing a retained-buffer row |
| `selectAll(): Promise<boolean>` | Select all retained history and the active screen |
| `clearSelection()` | Cancel Select All and clear this terminal's native selection |
| `clearSearch()` | Cancel search and remove highlights |
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

While the terminal is focused, handled key presses do not bubble to page-level
shortcut listeners. Control+K can reach the terminal instead of opening search.

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

The built-in and Ghostty cores answer `CSI ?2026$p` with the mode's current set/reset status. WTerm forwards this and other core responses through `onData`, so a connected application can detect synchronized output support.

Ordinary writes schedule `requestAnimationFrame` directly. Multiple writes before the frame are coalesced into one render.

When a terminal core supplies `CellData.chars`, the renderer paints that complete grapheme string instead of only the cell's base code point.

When a core supplies OSC 8 metadata through `CellData.linkUri` and `CellData.linkKey`, the renderer groups the covered cells into native anchors. Only absolute HTTP and HTTPS URIs become clickable. Invalid, relative, and executable schemes render as ordinary terminal text.
While hovering an anchor, holding Command on macOS or Control on Windows and Linux reveals its underline and pointer cursor. Plain clicks remain terminal interaction. Command-click, Control-click, or native keyboard activation when an anchor receives focus opens the link. Modified link activation remains available while SGR mouse tracking is active and is not forwarded to the terminal application.

WTerm answers xterm/Kitty pixel geometry queries (`CSI 14 t` and `CSI 16 t`) from the rendered terminal element and forwards the reports through `onData`, so Kitty graphics clients can size and place images in the browser.

Scrollback normally keeps only the visible rows plus overscan mounted in the DOM. Up to 1,000 selected history rows can also stay mounted, separately from a distant viewport. Gaps remain virtualized. Native browser find and accessibility inspect mounted rows, not every retained history row. Scrolling updates the window, while new output follows the exact bottom only when the terminal was already there.

WTerm owns scrollback anchoring when old history is discarded. The package stylesheet disables browser-native scroll anchoring on the terminal scroller so rollover produces one deterministic adjustment across browsers.

### Selecting and copying text

Use the browser's normal selection and Copy action. WTerm supplies plain text for selections entirely within contiguous mounted terminal rows. With Ghostty, confirmed soft wraps are joined, so a wrapped command copies as one line; explicit newlines remain `\n`. Cores without row-wrap metadata, including the built-in core, keep physical row breaks.

Copy preserves complete cell graphemes, emoji, CJK, block glyphs, and box-drawing characters. Selecting part of a multi-code-point cell copies that whole cell. Wide-cell continuations and flagged right-edge spacer heads add no text. Hyperlinks copy their displayed text without HTML or URLs. Trailing ASCII spaces are removed when selection reaches a hard row's right edge; spaces within text, across soft wraps, or at a partially selected row end are preserved.

```ts
const text = term.getSelectionText();
if (text !== null) {
  // Use in your own selection actions; this method does not write the clipboard.
  console.log(text);
}
```

The method reads the painted text, including while synchronized output holds a newer frame. It returns `null` for a collapsed or unavailable selection, selections extending outside this terminal, multiple ranges, or a gap in mounted history. In those cases, Copy keeps the browser's normal behavior. Input-field selections and previously handled copy events are also left to the host. An all-padding selection can return an empty string.

With Ghostty's current WASM binary, WTerm tracks both selection edges through output scrolling and resize/reflow and restores the native highlight, including backward selections. If selected text changes, an edge is discarded, or the application resets or switches screens, the selection clears. The copied text stays tied to what was selected. Resize reports applied dimensions immediately and rebuilds the DOM on the next paint frame.

Preservation covers native selections of at most 1,000 physical rows and 1,048,576 UTF-16 units. Reflow beyond the row limit clears a tracked selection. Larger selections, cores without `trackPosition`, and new selections made while an older frame awaits rendering retain native browser behavior and may change or clear on rendering. Select after the current frame has painted for tracked preservation. Native selection begins in mounted text. The method is available through the underlying WTerm instance in every framework binding.

#### Words and logical lines

Double-click a word or path to select it. Triple-click a row to select its complete logical line, including confirmed soft wraps and unmounted history. Single-click dragging keeps native browser selection. Hold Shift to select live text when an application reports mouse input; history stays selectable without Shift. Modified link clicks retain their normal behavior.

```ts
// Coordinates start at the oldest retained row; columns are terminal cells.
term.selectWord({ row: 10, col: 4 });
term.selectLine(10);
console.log(term.getSelectionText());
```

Both methods return `true` when a native selection is created. They return `false` for invalid coordinates, an unavailable or pending frame, or a range beyond 1,000 physical rows or 1,048,576 UTF-16 units. Mouse gestures fall back to browser selection in those cases. Route writes and resizes through WTerm and select after painting. Successful selection replaces Select All and releases terminal input focus so normal Copy works across browsers. Framework users access these methods through their WTerm instance.

Words use Ghostty's default boundary characters: spaces, tabs, quotes, backticks, vertical bars (including `│`), colons, semicolons, commas, parentheses, square/curly/angle brackets, and dollar signs. Adjacent boundary characters form their own run. Slashes, dots, hyphens, underscores, and Unicode text remain together. Either half of a wide glyph selects its complete grapheme. Line selection preserves indentation, trims trailing hard-line padding on copy, and excludes the next explicit newline. Unknown wrap boundaries, including the built-in core's, stop expansion at the physical row. These native selections use the preservation behavior described above.

#### Select All

Press **Cmd+A** or **Ctrl+Shift+A** while terminal input is focused to select all retained history and the active screen. **Ctrl+A** still reaches the shell. Copy with **Cmd+C**, **Ctrl+C**, or **Ctrl+Shift+C**. The shortcuts also work with Kitty keyboard mode. Escape clears Select All without sending Escape to the application.

```ts
if (await term.selectAll()) {
  console.log(term.getSelectionText());
}
term.clearSelection();
```

`selectAll(): Promise<boolean>` captures the complete buffer in cancellable batches after painting. It resolves `true` when ready, or `false` if unavailable, cancelled, or too large. It uses the same line/cell semantics as native Copy and includes blank screen rows. Only the active screen and its retained history are included; discarded history and the inactive screen are excluded. Virtual highlights do not mount extra rows or create a browser DOM selection. Set `--term-selection-bg` to customize their color. These methods are available through the underlying WTerm instance in every framework binding.

Select All retains at most 16,777,216 UTF-16 units. It never exposes or copies a truncated prefix. While preparing, `getSelectionText()` returns `null` and Copy is withheld; wait until “Selecting terminal text…” disappears before copying. A visible status reports cancellation during capture or failure. Selection remains intact while scrolling. Any `write` or `resize`, new input, pointer selection, focus outside the terminal, replacement selection, or destruction clears it. Route core mutations through WTerm. `clearSelection()` also clears a native selection wholly inside this terminal, leaving selections elsewhere untouched.

### Terminal search

```ts
term.onSearchChange = ({ count, activeIndex, searching, limited }) => {
  console.log({ count, activeIndex, searching, limited });
};
term.search("connection refused", { caseSensitive: false });
// Call from your Find controls:
term.findNext();
term.findPrevious();
term.clearSearch();
```

Search reads all retained rows, including unmounted history, in cancellable batches. Matches appear in chronological order; the first result is selected and revealed. `activeIndex` is zero-based, or -1 with no results. Navigation wraps among the matches found so far. Highlights preserve native text nodes and selection. Set `--term-search-match`, `--term-search-active`, and `--term-search-border` to customize their colors.

Ghostty joins confirmed soft wraps, including the history/screen boundary. Explicit newlines and unknown row boundaries separate matches; the built-in core currently searches each physical row independently. Search uses cell grapheme strings, omits wide-cell continuations and flagged spacer heads, and highlights the entire cell for partial-grapheme matches. Spaces, including terminal blank-cell padding, are literal; queries do not span hard line breaks. Regular expressions are not interpreted.

Case-insensitive matching is the default. It lowercases each Unicode code point independently using JavaScript's locale-independent `toLowerCase()`, without normalization or full case folding: `é` differs from `e` plus a combining acute, `ß` differs from `ss`, and final sigma differs from sigma. Lowercase expansions retain their original cell positions.

Queries are limited to 1,024 UTF-16 code units (`RangeError` otherwise). Up to 10,000 matches are retained; `limited` becomes true when another match exists. Narrow the query to reach additional matches. Empty queries cancel search. Output, pruning, resize, and screen switches clear stale results and restart after painting; continuous changes can delay completion. Refresh selects the first new result without scrolling away from the user's position. Synchronized output is searched after its paint is released. Destroying WTerm cancels outstanding work. Route mutations through WTerm's `write` and `resize` methods so search can track them.

`SearchOptions` and `SearchState` are exported from `@wterm/dom` and the framework packages. Framework users can access these methods and `onSearchChange` through the underlying WTerm instance. The host owns Find controls and shortcuts; the local workspace includes both.

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
