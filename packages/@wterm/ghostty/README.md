# @wterm/ghostty

Full-featured terminal emulation core for [wterm](https://github.com/vercel-labs/wterm), powered by [libghostty](https://ghostty.org) built from source.

Drop-in replacement for wterm's built-in Zig core. Implements the same `TerminalCore` interface with comprehensive VT emulation: proper Unicode grapheme handling, all SGR attributes, terminal modes, and more.

## Install

```bash
npm install @wterm/ghostty
```

## Usage

### Vanilla JS

```ts
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

const core = await GhosttyCore.load();
const term = new WTerm(document.getElementById("terminal"), { core });
await term.init();
```

### React

```tsx
import { Terminal } from "@wterm/react";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

const core = await GhosttyCore.load();

function App() {
  return <Terminal core={core} />;
}
```

### Vue

```vue
<script setup lang="ts">
import { Terminal } from "@wterm/vue";
import { GhosttyCore } from "@wterm/ghostty";

const core = await GhosttyCore.load();
</script>

<template>
  <Terminal :core="core" />
</template>
```

## Options

`GhosttyCore.load()` accepts an options object:

| Option | Type | Description |
|---|---|---|
| `wasmPath` | `string` | Custom path to the ghostty-vt WASM binary |
| `scrollbackLimit` | `number` | Maximum scrollback lines (default: 10000) |

## Architecture

The WASM binary is built from upstream [ghostty-org/ghostty](https://github.com/ghostty-org/ghostty) (v1.3.1) using it as a Zig package dependency — no third-party npm packages or pre-built binaries from other projects.

```
ghostty (Zig dep)  →  WASM patches  →  wasm_api.zig (~300 LOC)  →  ghostty-vt.wasm  →  TypeScript bindings
```

ghostty's `Terminal` and `Page` types use `posix.mmap` and Mach VM allocators internally, which don't exist on `wasm32-freestanding`. The build script applies small, targeted patches to replace these with `std.heap.wasm_allocator` behind comptime `isWasm()` checks (see `scripts/patch-ghostty-wasm.sh`). The patches are pinned to ghostty v1.3.1 and only touch two files: `page.zig` and `PageList.zig`.

The committed `wasm/ghostty-vt.wasm` binary means consumers never need Zig installed. Only maintainers rebuilding the WASM need Zig 0.15.x.

### Rebuilding the WASM

Requires [Zig 0.15.x](https://ziglang.org/download/) (ghostty's required version):

```bash
pnpm --filter @wterm/ghostty rebuild-wasm
```

This fetches the ghostty source via Zig's package manager, applies WASM compatibility patches, compiles our export layer to `wasm32-freestanding`, and copies the binary to `wasm/`.

### Upgrading ghostty

1. Edit the URL tag in `zig/build.zig.zon` to the new ghostty version
2. Run `zig fetch <new-url>` from the `zig/` directory to get the new hash
3. Update the hash in `build.zig.zon`
4. Verify the patches in `scripts/patch-ghostty-wasm.sh` still apply cleanly
5. Run `pnpm --filter @wterm/ghostty rebuild-wasm`

## Tradeoffs vs built-in core

| | Built-in (default) | `@wterm/ghostty` |
|---|---|---|
| Bundle size | ~12 KB WASM | ~400 KB WASM |
| VT compliance | Basic VT100/VT220/xterm | Comprehensive |
| Unicode | Single codepoints | Full grapheme clusters |
| Dependencies | None | None (WASM built from source) |
| Setup | Zero-config | Requires `@wterm/ghostty` install |

## License

Apache-2.0
