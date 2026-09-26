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
| `maxImageWidth` | `number` | — | Maximum rendered Kitty image width in CSS pixels; images scale down proportionally |
| `maxImageHeight` | `number` | — | Maximum rendered Kitty image height in CSS pixels; images scale down proportionally |
| `cursorBlink` | `boolean` | Application-controlled | Force blinking on (`true`) or off (`false`); omit to follow the terminal (initially steady) |
| `announceOutput` | `boolean` | `false` | Politely announce bounded terminal text changes while input has focus; updates without restarting |
| `renderingPaused` | `boolean` | `false` | Suspend painting for an inactive pane while parsing and terminal effects continue; mutable without restarting |
| `debug` | `boolean` | `false` | Enable debug mode. Exposes a `DebugAdapter` on the underlying `WTerm` instance for inspecting escape sequences, cell data, render performance, and unhandled CSI sequences. |

Standard DOM attributes (`class`, `style`, `id`, ARIA props, etc.) are forwarded to the root `<div>` via `inheritAttrs`.

The component delegates rendering to `@wterm/dom`, so passing a graphics-capable
core such as `@wterm/ghostty` renders direct Kitty PNG/RGB/RGBA output. Use
`maxImageWidth` and/or `maxImageHeight` to constrain oversized images while
preserving their aspect ratio. Image canvases are decorative and
`aria-hidden`; they are pointer-transparent and never replace the text rows.

## Events

| Event | Payload | Description |
|---|---|---|
| `data` | `(data: string)` | Emitted when the terminal produces data (user input or host response). When no listener is attached, input is echoed back automatically. |
| `binary` | `(data: Uint8Array)` | Emitted for raw X10 mouse reports. Send the bytes unchanged to a binary-capable transport; without a listener, only ASCII-safe reports reach `data`. |
| `title` | `(title: string)` | Emitted when the terminal title changes via an escape sequence. |
| `bell` | `(count: number)` | Emitted with the pending BEL count as output is written; the host controls any alert. |
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

## Reading output

Call `await instance.readText({ signal })` on the WTerm instance to capture retained history and the active screen without changing selection. Show the returned string in a labelled, read-only text area. Snapshots remain stable during new output; pending captures are cancellable and bounded. See [Reading terminal output](../dom/README.md#reading-terminal-output) for cancellation and resource limits.

## Input accessibility

Use `<Terminal aria-label="Build shell" aria-describedby="shell-help" />` to name and describe the actual input. `aria-labelledby` and `aria-description` are also supported, and attribute changes stay synchronized. The host defaults to a group; the native textarea is the editable control. `:tabindex="-1"` excludes input from page tab entry; the template ref's `focus()` method still focuses it. Press Escape, then Tab to move focus out of the terminal, or Escape, then Shift+Tab to move backward. See the [DOM input accessibility contract](../dom/README.md#input-accessibility) for host tab-order ownership and output limits.

## Selection and copy

Native Copy uses terminal line and cell semantics, joining Ghostty soft wraps while preserving explicit newlines and complete Unicode cells. Call `getSelectionText()` on the underlying WTerm instance to read the same text without accessing the clipboard. It returns `null` when no supported terminal selection exists. See [selection behavior and limits](../dom/README.md#selecting-and-copying-text).

With the current Ghostty WASM binary, selections follow output scrolling and resize/reflow while their text remains intact. Overwritten or discarded text, resets, and screen switches clear the selection. The linked reference describes preservation limits and pending-frame behavior.

Use `await instance.selectAll()` to select all retained history and the active screen, then read `instance.getSelectionText()`. Cmd+A or Ctrl+Shift+A invokes the same action while terminal input is focused. Capture is cancellable and bounded; output or resize clears it. Call `instance.clearSelection()` to cancel. See the linked selection reference for limits and copy shortcuts.

Double-click words or paths and triple-click logical lines. Use `instance.selectWord({ row, col })` or `instance.selectLine(row)` for the same selection from host controls; coordinates start at the oldest retained row. Ghostty joins confirmed soft wraps, including unmounted history. See the linked selection reference for boundaries, limits, and mouse-reporting behavior.

Alt/Option-drag selects rectangular columns; Shift+Alt selects inside mouse-reporting applications. Use `instance.selectRectangle(start, end)` with inclusive retained-row/cell corners, then read `instance.getSelectionText()`. Rectangles preserve selected spaces and physical row breaks, clear on output or resize, and keep scrolling bounded. See [rectangular selection](../dom/README.md#rectangular-selection) for copy shortcuts and limits.

## Terminal search

Use the underlying `WTerm` instance to call `search(query, { caseSensitive })`, `findNext()`, `findPrevious()`, `getSearchState()`, and `clearSearch()`. Set its `onSearchChange` callback to update your Find controls. Access the instance through `ready` or the template ref’s `instance`. Search includes unmounted retained history; Ghostty also joins soft wraps. See the [search semantics and limits](../dom/README.md#terminal-search).

## Output announcements

Set the reactive `announceOutput` prop to `true` to opt into polite announcements
while terminal input has focus. It defaults to `false` and can be toggled without
replacing the terminal. Announcements summarize changed text, are batched and
bounded, and stop when focus leaves input. See the [DOM announcement contract](../dom/README.md#output-announcements)
for pause/resume behavior, capture bounds, and redraw semantics.

## Inactive panes

Set the reactive `renderingPaused` prop for inactive panes. Toggling it keeps
the same terminal and core: output, history, replies, titles, and bells continue
while painting stops. Resuming schedules the latest state on the next eligible
frame. Hidden browser documents also pause painting. Hosts still control pane
visibility, focus, `inert`, and `aria-hidden`; CSS visibility alone does not set
this option. New searches, `readText()`, and Select All wait for painting to resume.

## License

Apache-2.0
