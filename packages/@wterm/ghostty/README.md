# @wterm/ghostty

Full-featured terminal emulation core for [wterm](https://github.com/vercel-labs/wterm), powered by [libghostty](https://ghostty.org) built from source.

Drop-in replacement for wterm's built-in Zig core. Implements the same `TerminalCore` interface with comprehensive VT emulation: proper Unicode grapheme handling, all SGR attributes, terminal modes, and more.

The core exposes mouse tracking (modes 1000, 1002, and 1003), its active wire encoding through `mouseEncoding()`, focus reporting (mode 1004), synchronized-output state (mode 2026), Kitty keyboard negotiation, and terminal responses including foreground/background color queries (OSC 10 and OSC 11) to `@wterm/dom`. With the DOM layer, X10, UTF-8 (1005), SGR (1006), urxvt (1015), and SGR pixel (1016) reports are supported. Mode 1003 reports unpressed pointer movement once per cell for cell formats and once per CSS pixel for 1016.
Combining marks and ZWJ emoji are exposed through `CellData.chars` as complete strings, including after their rows move into scrollback.

`CellData.spacerHead` marks the empty right-edge filler before a wrapped wide glyph. WTerm's full-history Find uses this flag, grapheme strings, and native row-wrap metadata to match text across soft wraps without inserting artificial spaces.

WTerm also uses this metadata when copying native text selections: soft wraps join without newlines, spacer heads are omitted, and partial graphemes copy as whole cells. Explicit newlines remain intact. See [selection and copy](../dom/README.md#selecting-and-copying-text).

`trackPosition({ row, col })` follows a retained cell through scrolling and reflow. The returned handle has `resolve()` and `dispose()` methods; row zero is the oldest retained row. It resolves to `null` after pruning, reset, screen switching, reinitialization, or disposal. Up to 64 simultaneous handles are supported; invalid coordinates, exhausted capacity, and older binaries return `null`. Release handles when finished. WTerm uses this API to preserve native selections and separately checks for overwritten text. See the [core contract](../core/README.md#tracked-cell-positions).

`getColorOverrides()` exposes application-requested default foreground,
background, and cursor colors from OSC 10/11/12. The DOM renderer applies them
to live cells, retained history, the terminal background, and cursor shapes.
OSC 110/111/112 restores the current CSS theme without rewriting host theme
variables. Explicit SGR colors remain unchanged. Serve the current WASM binary;
older binaries return an empty snapshot and retain their CSS defaults.

Ghostty preserves single, double, curly, dotted, and dashed underlines through
`CellData.underlineStyle`, with resolved colors in `underlineRgb`. The DOM
renderer displays them in the viewport and scrollback, including after reflow.
SGR `4:1` through `4:5` select the styles; `4` selects single and `21` selects
double. SGR `58` sets an indexed or RGB underline color, `59` restores the
foreground color, and `24` or `4:0` removes the underline. SGR `0` resets both.
Strikethrough stays solid and follows the text color. Apps serving an older
WASM file retain single underlines; serve the binary shipped with the package
to enable the additional styles and colors.

`getCursor()` exposes Ghostty's block, bar, or underline `shape` and `blinking`
state. The DOM renderer follows application requests (DECSCUSR and mode 12);
an explicit `cursorBlink: true` or `false` on the terminal wrapper overrides
blinking. Omitting the option follows the application, initially steady.

OSC 0 and OSC 2 window-title changes reach `getTitle()` and the terminal
wrapper's `onTitle` callback, including an empty title that clears the current
name. The callback runs as output is written, including while painting is
paused. Several changes within a parsed chunk may coalesce to the latest
complete title. Titles longer than Ghostty's 255-byte limit are ignored.

`getBellCount()` reads and clears Ghostty's pending BEL count. `WTerm` forwards
it through `onBell(count)` as output is written, even when synchronized output
holds painting. BEL used to terminate an OSC sequence is excluded.

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

`getRowMetadata(row)` and `getScrollbackRowMetadata(offset)` return
`{ wrapsToNext, continuesPrevious }` from Ghostty's native row flags. Live rows
start at zero; history offset zero is the newest retained row. They distinguish
soft wraps from explicit newlines, including across the live/history boundary
and after resize reflow. Results are snapshots: re-read after output or resize,
and treat row indexes as temporary. A retained row can continue an older row
that has already been discarded. Invalid positions, disposed cores, and older
WASM binaries without these exports return `null` rather than a hard-line
assumption. The methods read terminal state immediately, without requiring a
render or consuming dirty flags.

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
import { onMount } from "svelte";
import { Terminal } from "@wterm/svelte";
import { GhosttyCore } from "@wterm/ghostty";

let core: GhosttyCore | undefined;

onMount(() => {
  void GhosttyCore.load().then((loaded) => {
    core = loaded;
  });
});
</script>

{#if core}
  <Terminal {core} />
{/if}
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
ghostty (Zig dep)  →  WASM patches  →  wasm_api.zig  →  ghostty-vt.wasm  →  TypeScript bindings
```

ghostty's `Terminal` and `Page` types use `posix.mmap` and Mach VM allocators internally, which don't exist on `wasm32-freestanding`. The build script applies small, targeted patches to replace these with `std.heap.wasm_allocator`, expose the discarded-row count from `PageList`, forward the per-screen image limit, bound and compact Kitty image/placement metadata, and make direct PNG decoding work without POSIX time. It also adds the Wuffs freestanding compatibility include/source configuration in `zig/build.zig`. The patches are pinned to ghostty v1.3.1 and touch these upstream files:

- `src/terminal/Terminal.zig`
- `src/terminal/kitty/graphics_image.zig`
- `src/terminal/kitty/graphics_storage.zig`
- `src/terminal/kitty/graphics_exec.zig`
- `src/terminal/kitty/graphics_unicode.zig`
- `src/terminal/page.zig`
- `src/terminal/PageList.zig`

Page allocation also includes upstream's [WASM initialization fix](https://github.com/ghostty-org/ghostty/commit/420de124f04aa322bf250098cc62d7195db94bfd): initial and replacement terminal pages are cleared before use in release builds. Unlike native OS page allocation, the WASM allocator can return previously used memory. This keeps new page state independent of earlier terminal contents.

The Wuffs compatibility headers used by the build are `zig/src/wuffs-compat/{stdbool.h,stddef.h,stdint.h,stdlib.h,string.h}`; Wuffs itself is fetched from the pinned dependency in `zig/build.zig.zon`.

The committed `wasm/ghostty-vt.wasm` binary means consumers never need Zig installed. Only maintainers rebuilding the WASM need Zig 0.15.2.

### Rebuilding the WASM

Requires [Zig 0.15.2](https://ziglang.org/download/), Bash, and Python 3:

```bash
pnpm --filter @wterm/ghostty rebuild-wasm
```

The script checks the exact compiler version, fetches the upstream URL and
content hash from `zig/build.zig.zon`, and applies the WASM patches inside a
fresh temporary dependency cache. It verifies that applying the patches twice
produces identical files, builds `wasm32-freestanding` with `ReleaseSmall`,
and copies the completed binary to `wasm/ghostty-vt.wasm`. Temporary sources,
caches, and build output live under `/tmp` and are removed when the build
exits. Your shared Zig cache is never read or patched.

The script finds Zig 0.15.2 on `PATH` or in the usual zigup installation.
To select an executable explicitly, set `WTERM_GHOSTTY_ZIG=/path/to/zig`.
Zig 0.15.2 cannot link its native build runner on macOS 26; use Docker there:

```bash
pnpm --filter @wterm/ghostty rebuild-wasm:docker
```

The Linux installer used by Docker and CI verifies the compiler archive's
SHA-256 before extracting it. Version and archive checksums are recorded in
`scripts/zig-toolchain.sh`; consumers still only need the committed WASM.

To verify the committed binary without replacing it:

```bash
pnpm --filter @wterm/ghostty check-wasm
# Or use a Linux container with the checkout mounted read-only:
pnpm --filter @wterm/ghostty check-wasm:docker
```

CI runs the Ghostty drift check on every PR and push to `main`, separately from
the built-in core's Zig 0.16 build. A missing or differing artifact fails the
check with a rebuild command. Commit the regenerated WASM with changes to the
adapter, upstream dependency, patches, or toolchain that affect its output.

### Public API experiment

The repository also contains an isolated
[public libghostty WASM probe](../../../experiments/libghostty/README.md), using
an unpatched upstream revision and Zig 0.16.0. Run `pnpm test:libghostty` from
the repository root to build it and exercise rendering, terminal effects,
history, and snapshots in Node and browser engines. It does not replace this
package's v1.3.1 binary: the probed freestanding build disables Kitty graphics,
and the public API still has gaps against the adapter's history, hyperlink
identity, and resource-reporting contracts. The experiment documents the
verified behavior and remaining compatibility gaps.

### Upgrading ghostty

1. Edit the URL tag in `zig/build.zig.zon` to the new ghostty version
2. Run `zig fetch <new-url>` from the `zig/` directory to get the new hash
3. Update the hash in `build.zig.zon`
4. Verify the patches in `scripts/patch-ghostty-wasm.sh` still apply cleanly
5. Run `pnpm --filter @wterm/ghostty rebuild-wasm`

## Tradeoffs vs built-in core

| | Built-in (default) | `@wterm/ghostty` |
|---|---|---|
| WASM binary size | ~26 KB | ~580 KB |
| VT compliance | Basic VT100/VT220/xterm | Comprehensive |
| Unicode | Single codepoints | Full grapheme clusters |
| Dependencies | None | None (WASM built from source) |
| Setup | Zero-config | Requires `@wterm/ghostty` install |

## License

Apache-2.0
