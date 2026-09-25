# @wterm/svelte

Svelte component for [wterm](https://github.com/vercel-labs/wterm) — a terminal emulator for the web.

## Install

```bash
npm install @wterm/dom @wterm/svelte svelte
```

## Usage

```svelte
<script lang="ts">
  import { Terminal } from "@wterm/svelte";
  import "@wterm/svelte/css";
</script>

<Terminal />
```

The WASM binary is embedded in the package. Pass `wasmUrl` to serve it as a
separate static asset instead.

By default, typed input is echoed back to the terminal. Use the callback props
when input needs to be sent to a PTY or another backend:

```svelte
<script lang="ts">
  import { Terminal } from "@wterm/svelte";
  import "@wterm/svelte/css";

  function onData(data: string) {
    socket.send(data);
  }
</script>

<Terminal {onData} />
```

## Props

The terminal accepts the shared `WTerm` options `cols`, `rows`, `core`,
`wasmUrl`, `autoResize`, `maxImageWidth`, `maxImageHeight`, `cursorBlink`, `announceOutput`, and
`debug`, plus these Svelte callbacks:

| Prop       | Type                                   | Default | Description                                                                               |
| ---------- | -------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `theme`    | `string`                               | —       | Theme name, such as `"solarized-dark"`, `"monokai"`, or `"light"`                         |
| `onData`   | `(data: string) => void`               | —       | Called for terminal input and host responses; when omitted, input is echoed automatically |
| `onBinary` | `(data: Uint8Array) => void`           | —       | Called with raw X10 mouse reports for a binary-capable transport; without it, only ASCII-safe reports reach `onData` |
| `onTitle`  | `(title: string) => void`              | —       | Called when the terminal title changes                                                    |
| `onBell`   | `(count: number) => void`              | —       | Called with the pending BEL count; the host controls any alert                            |
| `onResize` | `(cols: number, rows: number) => void` | —       | Called after the terminal is resized                                                      |
| `onReady`  | `(wt: WTerm) => void`                  | —       | Called after initialization completes                                                     |
| `onError`  | `(error: unknown) => void`             | —       | Called if WASM loading or initialization fails                                            |

Standard `<div>` attributes, including `class`, `style`, `id`, and ARIA
attributes, are forwarded to the root element. `className` is also accepted as
a convenience for code shared with React.

Cursor shape follows the application (block, bar, or underline). Omit
`cursorBlink` to follow its blink requests, initially steady; set it to `true`
or `false` to force blinking on or off. Changing the prop back to `undefined`
restores application control without remounting the terminal.

The component delegates rendering to `@wterm/dom`, so passing a graphics-capable
core such as `@wterm/ghostty` renders direct Kitty PNG/RGB/RGBA images. Use
`maxImageWidth` and/or `maxImageHeight` to constrain oversized images while
preserving their aspect ratio.

## Imperative control

Bind the component instance to call `write`, `resize`, and `focus`:

```svelte
<script lang="ts">
  import { Terminal, type TerminalHandle } from "@wterm/svelte";

  let terminal: TerminalHandle;
</script>

<Terminal bind:this={terminal} />

<button onclick={() => terminal?.write("hello\r\n")}>Write</button>
<button onclick={() => terminal?.focus()}>Focus</button>
```

To access the underlying `WTerm`, bind the `instance` prop:

```svelte
<script lang="ts">
  import { Terminal, type WTerm } from "@wterm/svelte";

  let instance: WTerm | null = null;
</script>

<Terminal bind:instance />
```

## Themes

Import the stylesheet and switch themes with the `theme` prop:

```svelte
<script lang="ts">
  import { Terminal } from "@wterm/svelte";
  import "@wterm/svelte/css";
</script>

<Terminal theme="monokai" />
```

Built-in themes: `solarized-dark`, `monokai`, and `light`. Define custom themes
with CSS custom properties.

## Reading output

Call `await instance.readText({ signal })` on the WTerm instance to capture retained history and the active screen without changing selection. Show the returned string in a labelled, read-only text area. Snapshots remain stable during new output; pending captures are cancellable and bounded. See [Reading terminal output](../dom/README.md#reading-terminal-output) for cancellation and resource limits.

## Input accessibility

Use `<Terminal aria-label="Build shell" aria-describedby="shell-help" />` to name and describe the actual input. `aria-labelledby` and `aria-description` are also supported, and attribute changes stay synchronized. The host defaults to a group; the native textarea is the editable control. `tabindex={-1}` excludes input from page tab entry; the component's `focus()` method still focuses it. Press Escape, then Tab to move focus out of the terminal, or Escape, then Shift+Tab to move backward. See the [DOM input accessibility contract](../dom/README.md#input-accessibility) for host tab-order ownership and output limits.

## Selection and copy

Native Copy uses terminal line and cell semantics, joining Ghostty soft wraps while preserving explicit newlines and complete Unicode cells. Call `getSelectionText()` on the underlying WTerm instance to read the same text without accessing the clipboard. It returns `null` when no supported terminal selection exists. See [selection behavior and limits](../dom/README.md#selecting-and-copying-text).

With the current Ghostty WASM binary, selections follow output scrolling and resize/reflow while their text remains intact. Overwritten or discarded text, resets, and screen switches clear the selection. The linked reference describes preservation limits and pending-frame behavior.

Use `await instance.selectAll()` to select all retained history and the active screen, then read `instance.getSelectionText()`. Cmd+A or Ctrl+Shift+A invokes the same action while terminal input is focused. Capture is cancellable and bounded; output or resize clears it. Call `instance.clearSelection()` to cancel. See the linked selection reference for limits and copy shortcuts.

Double-click words or paths and triple-click logical lines. Use `instance.selectWord({ row, col })` or `instance.selectLine(row)` for the same selection from host controls; coordinates start at the oldest retained row. Ghostty joins confirmed soft wraps, including unmounted history. See the linked selection reference for boundaries, limits, and mouse-reporting behavior.

## Terminal search

Use the underlying `WTerm` instance to call `search(query, { caseSensitive })`, `findNext()`, `findPrevious()`, `getSearchState()`, and `clearSearch()`. Set its `onSearchChange` callback to update your Find controls. Access the instance through `onReady` or `bind:instance`. Search includes unmounted retained history; Ghostty also joins soft wraps. See the [search semantics and limits](../dom/README.md#terminal-search).

## Output announcements

Set the reactive `announceOutput` prop to `true` to opt into polite announcements
while terminal input has focus. It defaults to `false` and can be toggled without
replacing the terminal. Announcements summarize changed text, are batched and
bounded, and stop when focus leaves input. See the [DOM announcement contract](../dom/README.md#output-announcements)
for pause/resume behavior, capture bounds, and redraw semantics.

## License

Apache-2.0
