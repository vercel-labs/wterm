# Kitty Graphics Protocol Example

A self-contained demo of inline image rendering in `wterm` via the [Kitty terminal graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/).

Generates a PNG on the fly with `<canvas>` and transmits it through the protocol's chunked APC `\x1b_G...\x1b\\` transport. `@wterm/dom` intercepts the sequence and renders the image as an absolutely-positioned overlay aligned to the cell grid.

## Setup

From the monorepo root:

```bash
pnpm install
pnpm --filter kitty-images-example dev
```

Opens at `kitty-images.wterm.localhost` via [portless](https://github.com/vercel-labs/portless).

## How It Works

- `WTerm` enables image handling by default; APC `_G...` sequences are stripped from the byte stream before it reaches the VT core.
- The protocol payload is base64-encoded PNG bytes. Multi-chunk transfers (`m=1` … `m=0`) accumulate before decoding.
- Each placement is anchored to the cursor row at the moment the sequence is processed. Because new lines are inserted into scrollback above the grid, the image stays pixel-aligned with its content as the screen scrolls.

## Key Files

| File          | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `src/main.ts` | Generates a PNG with canvas and transmits it as a chunked Kitty APC |
| `index.html`  | Minimal HTML with `<div id="terminal">`                             |
