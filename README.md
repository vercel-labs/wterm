# wterm

<p>
  <a href="https://vercel.com/labs#active-experiments"><img alt="Vercel Labs Experiment" src="https://img.shields.io/badge/LABS-EXPERIMENT-0a0a0a.svg?style=for-the-badge&amp;logo=Vercel&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/@wterm/core"><img alt="npm version: @wterm/core" src="https://img.shields.io/npm/v/%40wterm%2Fcore.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://github.com/vercel-labs/wterm/blob/main/LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/github/license/vercel-labs/wterm.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/@wterm/core"><img alt="npm downloads per month: @wterm/core" src="https://img.shields.io/npm/dm/%40wterm%2Fcore.svg?style=for-the-badge&amp;labelColor=000000&amp;label=npm%20downloads" height="28"></a>
</p>

A terminal emulator for the web.

wterm ("dub-term") renders terminal rows as DOM text, so native text selection, copy and paste, browser find, and screen readers work on the mounted rows. The core is a VT parser written in Zig and compiled to a ~26 KB WASM binary.

## Install

```bash
npm install @wterm/dom @wterm/react
```

For Vue or Svelte, install `@wterm/vue` or `@wterm/svelte` with `@wterm/dom` instead of the React package. Vanilla JavaScript needs only `@wterm/dom`. The WASM binary is embedded in the package, so no extra file needs to be served.

## Quick start

```tsx
import { Terminal } from "@wterm/react";
import "@wterm/react/css";

function App() {
  return <Terminal />;
}
```

In vanilla JavaScript, mount a terminal on an element:

```js
import { WTerm } from "@wterm/dom";
import "@wterm/dom/css";

const term = new WTerm(document.getElementById("terminal"));
await term.init();
```

To connect a shell, send keyboard input from `onData` to a PTY backend and write its output back with `term.write()`, or use `WebSocketTransport` from `@wterm/core`. The [Next.js](examples/nextjs), [SSH](examples/ssh), and [local shell](examples/local) examples show both ends. Every framework is covered in [Get started](https://wterm.dev/get-started).

## How it works

A terminal core parses escape sequences and holds the screen and scrollback. The DOM renderer reads the core's dirty rows on each animation frame and updates only those rows. History is a ring buffer, and only a bounded window of it is mounted in the DOM.

There are two cores. The built-in Zig core loads by default. [`@wterm/ghostty`](https://wterm.dev/ghostty) swaps in libghostty for fuller VT compatibility, including Kitty images, OSC 133 shell integration, and reflow of soft-wrapped lines. Both implement the `TerminalCore` interface, so the renderer and framework components work with either ([Pluggable cores](https://wterm.dev/configuration#pluggable-cores)).

For pages with many busy terminals, `renderer: "webgl"` paints from one shared WebGL2 context while DOM text keeps selection, find, and screen readers working, and `WorkerCore` moves parsing off the main thread ([WebGL renderer](https://wterm.dev/configuration#webgl-renderer), [Worker core](https://wterm.dev/configuration#worker-core)).

## Packages

| Package | Description |
|---|---|
| [`@wterm/core`](packages/@wterm/core) | Headless WASM bridge, `TerminalCore` interface, WebSocket transport |
| [`@wterm/dom`](packages/@wterm/dom) | DOM renderer and input handler for vanilla JavaScript |
| [`@wterm/react`](packages/@wterm/react) | React component and `useTerminal` hook |
| [`@wterm/vue`](packages/@wterm/vue) | Vue 3 component and template ref API |
| [`@wterm/svelte`](packages/@wterm/svelte) | Svelte component and callback API |
| [`@wterm/ghostty`](packages/@wterm/ghostty) | VT emulation core powered by libghostty |
| [`@wterm/just-bash`](packages/@wterm/just-bash) | In-browser Bash shell powered by just-bash |
| [`@wterm/markdown`](packages/@wterm/markdown) | Render Markdown in the terminal |

## For AI agents

Set `webmcp` on a terminal to register [WebMCP](https://wterm.dev/webmcp) tools. In-page agents can then list terminals, read the screen and scrollback, wait for output, type commands, and press keys. A read-only mode lets agents watch a terminal without typing into it:

```tsx
<Terminal webmcp={{ name: "shell" }} onData={send} />
```

`term.readText()` returns a text snapshot of retained history and the active screen. The docs are also available as Markdown from [wterm.dev/llms.txt](https://wterm.dev/llms.txt).

## Documentation

| Topic | Docs |
|---|---|
| Install and first terminal | [Get started](https://wterm.dev/get-started) |
| Options, renderers, cores, WebSocket transport | [Configuration](https://wterm.dev/configuration) |
| Built-in themes and CSS custom properties | [Themes](https://wterm.dev/themes) |
| Methods, events, selection, search, images | [API reference](https://wterm.dev/api-reference) |
| Framework bindings | [React](https://wterm.dev/react), [Vue](https://wterm.dev/vue), [Svelte](https://wterm.dev/svelte), [Vanilla JS](https://wterm.dev/vanilla) |
| Ghostty core, image limits, shell integration | [Ghostty](https://wterm.dev/ghostty) |
| In-browser shell and Markdown output | [just-bash](https://wterm.dev/just-bash), [Markdown](https://wterm.dev/markdown) |
| Agent tools | [WebMCP](https://wterm.dev/webmcp) |
| Runnable apps | [`examples/`](examples) |
| Release notes | [Changelog](CHANGELOG.md) |

## Development

This repo is a pnpm workspace with [Turborepo](https://turbo.build). Use [Zig](https://ziglang.org/) 0.16.0 or later, Node.js 24 or later, and pnpm 11. Dev servers run behind [portless](https://github.com/vercel-labs/portless), installed globally.

```bash
pnpm install
zig build test
pnpm build
pnpm test
```

`zig build -Doptimize=ReleaseSmall` writes `zig-out/bin/wterm.wasm` and `web/wterm.wasm`. The committed binary is `packages/@wterm/core/wasm/wterm.wasm`, and CI fails when it does not match the Zig sources, so copy the release build there and commit it with any change under `src/`.

[CONTRIBUTING.md](CONTRIBUTING.md#development) covers the Ghostty WASM build, the docs site, the examples, and the PTY, replay, and performance suites. [AGENTS.md](AGENTS.md) lists the files to update with each change and the release process.

## License

Apache-2.0
