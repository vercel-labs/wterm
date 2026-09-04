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
`wasmUrl`, `autoResize`, `maxImageWidth`, `maxImageHeight`, `cursorBlink`, and
`debug`, plus these Svelte callbacks:

| Prop       | Type                                   | Default | Description                                                                               |
| ---------- | -------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `theme`    | `string`                               | —       | Theme name, such as `"solarized-dark"`, `"monokai"`, or `"light"`                         |
| `onData`   | `(data: string) => void`               | —       | Called for terminal input and host responses; when omitted, input is echoed automatically |
| `onTitle`  | `(title: string) => void`              | —       | Called when the terminal title changes                                                    |
| `onResize` | `(cols: number, rows: number) => void` | —       | Called after the terminal is resized                                                      |
| `onReady`  | `(wt: WTerm) => void`                  | —       | Called after initialization completes                                                     |
| `onError`  | `(error: unknown) => void`             | —       | Called if WASM loading or initialization fails                                            |

Standard `<div>` attributes, including `class`, `style`, `id`, and ARIA
attributes, are forwarded to the root element. `className` is also accepted as
a convenience for code shared with React.

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

## License

Apache-2.0
