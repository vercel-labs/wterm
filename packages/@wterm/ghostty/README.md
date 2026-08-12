# @wterm/ghostty

Full-featured terminal emulation core for [wterm](https://github.com/vercel-labs/wterm), powered by [libghostty](https://ghostty.org) built from source.

Drop-in replacement for wterm's built-in Zig core. Implements the same `TerminalCore` interface with comprehensive VT emulation: proper Unicode grapheme handling, all SGR attributes, terminal modes, and more.

The core exposes SGR mouse tracking (modes 1000, 1002, and 1006), focus reporting (mode 1004), synchronized-output state (mode 2026), and terminal responses including foreground/background color queries (OSC 10 and OSC 11) to `@wterm/dom`.
Combining marks and ZWJ emoji are exposed through `CellData.chars` as complete strings, including after their rows move into scrollback.
Native OSC 8 hyperlinks are resolved from Ghostty's page-owned metadata and exposed through `CellData.linkUri`, `CellData.linkId`, and `CellData.linkKey` in both the viewport and scrollback.

Ghostty also exposes the cumulative number of rows discarded from the oldest end of scrollback. `@wterm/dom` uses that signal to keep retained history anchored when the page budget rolls over.

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
| `scrollbackLimit` | `number` | Scrollback budget in bytes, not lines (default: 10000). ghostty allocates history in pages, so the retained row count depends on the terminal width |
| `foregroundColor` | `string` | Foreground reported by OSC 10 in `#RRGGBB` format (default: `#d4d4d4`) |
| `backgroundColor` | `string` | Background reported by OSC 11 in `#RRGGBB` format (default: `#1e1e1e`) |

When using a custom CSS theme, pass matching foreground and background colors so terminal applications receive the colors they are actually rendered with:

```ts
const core = await GhosttyCore.load({
  foregroundColor: "#ededed",
  backgroundColor: "#0a0a0a",
});
```

## Bundlers

The WASM binary is fetched at runtime, not inlined, so the default has to resolve to a URL your app actually serves. `GhosttyCore.load()` resolves it with `new URL("../wasm/ghostty-vt.wasm", import.meta.url)`. Bundlers that implement that asset pattern emit the binary and rewrite the URL; ones that do not leave `import.meta.url` pointing at the machine that built the bundle.

| Bundler | Default `GhosttyCore.load()` | Verified |
|---|---|---|
| Vite (dev and build) | works, emits a hashed asset | yes |
| Bun dev server | fails, pass `wasmPath` | yes |
| Others | untested, use `wasmPath` if the default throws | no |

When the default cannot work, serve the binary yourself and point at it:

```bash
cp node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm public/ghostty-vt.wasm
```

```ts
const core = await GhosttyCore.load({ wasmPath: "/ghostty-vt.wasm" });
```

The binary is also addressable as `@wterm/ghostty/ghostty-vt.wasm`, so a bundler with a URL import can take it directly:

```ts
import wasmPath from "@wterm/ghostty/ghostty-vt.wasm?url";

const core = await GhosttyCore.load({ wasmPath });
```

## Architecture

The WASM binary is built from upstream [ghostty-org/ghostty](https://github.com/ghostty-org/ghostty) (v1.3.1) using it as a Zig package dependency — no third-party npm packages or pre-built binaries from other projects.

```
ghostty (Zig dep)  →  WASM patches  →  wasm_api.zig (~300 LOC)  →  ghostty-vt.wasm  →  TypeScript bindings
```

ghostty's `Terminal` and `Page` types use `posix.mmap` and Mach VM allocators internally, which don't exist on `wasm32-freestanding`. The build script applies small, targeted patches to replace these with `std.heap.wasm_allocator` and expose the discarded-row count from `PageList` (see `scripts/patch-ghostty-wasm.sh`). The patches are pinned to ghostty v1.3.1 and only touch two files: `page.zig` and `PageList.zig`.

The committed `wasm/ghostty-vt.wasm` binary means consumers never need Zig installed. Only maintainers rebuilding the WASM need Zig 0.15.x.

### Rebuilding the WASM

Requires [Zig 0.15.x](https://ziglang.org/download/) (ghostty's required version):

```bash
pnpm --filter @wterm/ghostty rebuild-wasm
```

This fetches the ghostty source via Zig's package manager, applies WASM compatibility patches, compiles our export layer to `wasm32-freestanding`, and copies the binary to `wasm/`.

If the host toolchain cannot build, run the same script in a Linux container:

```bash
pnpm --filter @wterm/ghostty rebuild-wasm:docker
```

Zig 0.15.x cannot link a native build runner on macOS 26, and Zig 0.16 fails inside ghostty's vendored build files, so neither drives `rebuild-wasm` there. The wasm target itself is unaffected. Container output is byte-identical to a host build.

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
