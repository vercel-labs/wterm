# @wterm/ghostty

Full-featured terminal emulation core for [wterm](https://github.com/vercel-labs/wterm), powered by [libghostty](https://ghostty.org) built from source.

Drop-in replacement for wterm's built-in Zig core. Implements the same `TerminalCore` interface with comprehensive VT emulation: proper Unicode grapheme handling, all SGR attributes, terminal modes, and more.

The core exposes SGR mouse tracking (modes 1000, 1002, and 1006), focus reporting (mode 1004), synchronized-output state (mode 2026), Kitty keyboard negotiation, and terminal responses including foreground/background color queries (OSC 10 and OSC 11) to `@wterm/dom`.
Combining marks and ZWJ emoji are exposed through `CellData.chars` as complete strings, including after their rows move into scrollback.
Native OSC 8 hyperlinks are resolved from Ghostty's page-owned metadata and exposed through `CellData.linkUri`, `CellData.linkId`, and `CellData.linkKey` in both the viewport and scrollback.

The Ghostty core also provides the optional terminal graphics API. The DOM
renderer displays direct Kitty Graphics Protocol PNG/RGB/RGBA images as
transient, bounded canvas overlays. Pinned placements follow scrollback,
scrolling, resize, and primary/alternate screen changes. Sixel, iTerm2/OSC
1337, animation, virtual Unicode placements, file/shared-memory/URL media, and
image persistence are not supported. Auto-sized (implicit) placements align
with the terminal content origin and reserve their rendered height in the
visual DOM flow so prompts emitted after an image remain visible below it.

Ghostty also exposes the cumulative number of rows discarded from the oldest end of scrollback. `@wterm/dom` uses that signal to keep retained history anchored when the page budget rolls over.

Kitty keyboard flags stay authoritative in Ghostty's active screen. Queries return the native value, primary and alternate screens negotiate independently, DECSTR preserves the flags, and RIS clears them. `@wterm/dom` encodes browser keyboard events from those flags with the browser limitations documented in its README.

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

### Svelte

```svelte
<script lang="ts">
import { Terminal } from "@wterm/svelte";
import { GhosttyCore } from "@wterm/ghostty";

const core = await GhosttyCore.load();
</script>

<Terminal {core} />
```

## Options

`GhosttyCore.load()` accepts an options object:

| Option | Type | Description |
|---|---|---|
| `wasmPath` | `string` | Custom path to the ghostty-vt WASM binary |
| `scrollbackLimit` | `number` | Scrollback budget in bytes, not lines (default: 10000). ghostty allocates history in pages, so the retained row count depends on the terminal width |
| `foregroundColor` | `string` | Foreground reported by OSC 10 in `#RRGGBB` format (default: `#d4d4d4`) |
| `backgroundColor` | `string` | Background reported by OSC 11 in `#RRGGBB` format (default: `#1e1e1e`) |
| `imageStorageLimit` | `number` | Maximum decoded Kitty image bytes per screen (default: 32 MiB; `0` disables graphics) |

When using a custom CSS theme, pass matching foreground and background colors so terminal applications receive the colors they are actually rendered with:

```ts
const core = await GhosttyCore.load({
  foregroundColor: "#ededed",
  backgroundColor: "#0a0a0a",
  imageStorageLimit: 32 * 1024 * 1024,
});
```

The image limit applies to decoded image storage, not browser canvas count.
Each direct image is also capped at `MAX_IMAGE_BYTES` (32 MiB), even when a
larger `imageStorageLimit` is configured; the larger budget can hold multiple
smaller images. Each screen also retains at most 4,096 image descriptors and
4,096 placements, so unique tiny-image churn cannot grow WASM metadata without
bound; additional records fail closed until existing records are removed.
The DOM overlay independently caps visible canvas backing stores at 32 MiB and
bounds each destination canvas to the terminal pixel area; placements that do
not fit those browser limits are skipped.
Ghostty rejects oversized, malformed, and non-direct media before any file or
shared-memory access. `getResourceState()` reports image count, placement
count, bytes used/capacity, rejections, evictions, and saturation.

The core returns copied metadata and RGBA buffers through the optional
`TerminalCore` graphics methods. Call `core.dispose()` when the application
owns the core lifecycle; `WTerm.destroy()` cleans up its DOM layer but never
disposes a caller-supplied core automatically.

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

ghostty's `Terminal` and `Page` types use `posix.mmap` and Mach VM allocators internally, which don't exist on `wasm32-freestanding`. The build script applies small, targeted patches to replace these with `std.heap.wasm_allocator`, expose the discarded-row count from `PageList`, forward the per-screen image limit, bound and compact Kitty image/placement metadata, and make direct PNG decoding work without POSIX time. It also adds the Wuffs freestanding compatibility include/source configuration in `zig/build.zig`. The patches are pinned to ghostty v1.3.1 and touch these upstream files:

- `src/terminal/Terminal.zig`
- `src/terminal/kitty/graphics_image.zig`
- `src/terminal/kitty/graphics_storage.zig`
- `src/terminal/kitty/graphics_exec.zig`
- `src/terminal/kitty/graphics_unicode.zig`
- `src/terminal/page.zig`
- `src/terminal/PageList.zig`

The Wuffs compatibility headers used by the build are `zig/src/wuffs-compat/{stdbool.h,stddef.h,stdint.h,stdlib.h,string.h}`; Wuffs itself is fetched from the pinned dependency in `zig/build.zig.zon`.

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
