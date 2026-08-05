# @wterm/svelte

Svelte component for [wterm](https://github.com/vercel-labs/wterm), a terminal emulator for the web. Re-exports everything from `@wterm/dom`, so a single package import covers both the component and terminal types.

## Install

```bash
npm install @wterm/dom @wterm/svelte
```

## Usage

```svelte
<script lang="ts">
  import { Terminal } from "@wterm/svelte";
  import "@wterm/svelte/css";
</script>

<Terminal />
```

## Props

`Terminal` accepts all shared terminal options: `cols`, `rows`, `core`, `wasmUrl`, `autoResize`, `cursorBlink`, and `debug`.

It also accepts a `theme` prop, which applies a `theme-<name>` class to the root element. Standard `div` attributes like `class`, `style`, `id`, and ARIA props are forwarded to the root element.

## Callback Props

Svelte 5 uses callback props for component events:

```svelte
<Terminal
  onData={(data) => socket.send(data)}
  onTitle={(title) => (document.title = title)}
  onResize={(cols, rows) => socket.send(JSON.stringify({ cols, rows }))}
  onReady={(wt) => wt.write("ready\r\n")}
  onError={(err) => console.error(err)}
/>
```

When no `onData` callback is provided, input is echoed back automatically by `@wterm/dom`.

## Imperative API

Use `bind:this` to access methods:

```svelte
<script lang="ts">
  import { Terminal, type WTerm } from "@wterm/svelte";

  let terminal: Terminal;

  function onReady(wt: WTerm) {
    wt.write("hello\r\n");
    terminal.resize(120, 40);
  }
</script>

<Terminal bind:this={terminal} {onReady} />
```

The instance exposes `write(data)`, `resize(cols, rows)`, `focus()`, and `instance()` to access the underlying `WTerm | null`.

## Themes

```svelte
<script lang="ts">
  import { Terminal } from "@wterm/svelte";
  import "@wterm/svelte/css";
</script>

<Terminal theme="monokai" />
```

Built-in themes are `solarized-dark`, `monokai`, and `light`. Define custom themes with CSS custom properties (`--term-fg`, `--term-bg`, `--term-color-0` through `--term-color-15`).
