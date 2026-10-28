<div align="center">

# wterm

A terminal emulator for the web.

[![labs](https://img.shields.io/badge/vercel-labs-000000?style=flat-square&logo=vercel&labelColor=000000)](https://vercel.com/labs#active-experiments)
[![npm](https://img.shields.io/npm/v/%40wterm%2Fcore?style=flat-square&labelColor=000000&color=333333)](https://www.npmjs.com/package/@wterm/core)
[![downloads](https://img.shields.io/npm/dm/%40wterm%2Fcore?style=flat-square&labelColor=000000&color=333333)](https://www.npmjs.com/package/@wterm/core)
[![license](https://img.shields.io/github/license/vercel-labs/wterm?style=flat-square&labelColor=000000&color=333333)](LICENSE)

[wterm.dev](https://wterm.dev)

</div>

wterm ("dub-term") renders terminal rows as DOM text, so selection, copy and paste, browser find and screen readers work as they do on any page. Parsing runs in WASM: a small built-in Zig core, or [libghostty](packages/@wterm/ghostty) for full VT compatibility, images and shell integration.

## Install

```sh
npm i @wterm/dom
```

## Quick start

```js
import { WTerm } from "@wterm/dom";
import "@wterm/dom/css";

const term = new WTerm(document.getElementById("terminal"), {
  onData: (data) => socket.send(data),
});
await term.init();
socket.onmessage = (event) => term.write(event.data);
```

React, Vue and Svelte: `npm i @wterm/react`, `@wterm/vue` or `@wterm/svelte`.

## Packages

| Package | |
| --- | --- |
| [`@wterm/dom`](packages/@wterm/dom) | Renderer and input, no framework |
| [`@wterm/react`](packages/@wterm/react) · [`vue`](packages/@wterm/vue) · [`svelte`](packages/@wterm/svelte) | Components |
| [`@wterm/core`](packages/@wterm/core) | Built-in WASM core, `WorkerCore`, `TerminalCore` interface, WebSocket transport |
| [`@wterm/ghostty`](packages/@wterm/ghostty) | libghostty core |
| [`@wterm/just-bash`](packages/@wterm/just-bash) | Bash in the browser |
| [`@wterm/markdown`](packages/@wterm/markdown) | Markdown in the terminal |

## Develop

```sh
pnpm install
pnpm build
pnpm test
```

## More

- [docs/features.md](docs/features.md): everything the terminal supports
- [docs/development.md](docs/development.md): WASM builds, examples, docs site, test and measurement suites
- [CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md)

Apache-2.0
