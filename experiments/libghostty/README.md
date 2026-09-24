# Public libghostty WASM probe

The public libghostty C API can supply styled graphemes, cursor state, terminal
effects, retained-history search, tracked positions, and restorable parser state
from an unpatched WASM build. **Keep the shipped v1.3.1 adapter:** this upstream
build disables Kitty graphics, and its public interface does not yet cover all
of wterm's history, hyperlink identity, and resource-reporting contracts.

This directory is a private experiment. It does not change published package
exports, the default core, or either committed WASM binary. Its JavaScript
bindings exercise public headers; they do not implement `TerminalCore` or connect
to the DOM renderer.

## Reproduce

Run from the repository root with Node.js 24+, pnpm 11+, curl, tar, and **Zig
0.16.0**. This is a different toolchain from the shipped adapter's Zig 0.15.x.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox webkit
pnpm test:libghostty
```

On Linux, use `pnpm exec playwright install --with-deps chromium firefox webkit`
to install browser system dependencies too. Set `LIBGHOSTTY_ZIG=/path/to/zig` if
Zig 0.16.0 is not the default executable.

The source pin and archive checksum live in [upstream.json](upstream.json):

- Ghostty revision [`7c40388b2c63b7dcc5d6c9b9804e40fb2574444f`][upstream]
  (September 24, 2026; source version `1.3.2-dev`).
- Archive SHA-256: `07eb5e29a425aebcb30fb633ecdfa95fd42fac9479a29680b2d566c9d6b4d8f4`.
- Official build: `zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall`.

[build.mjs](build.mjs) verifies the archive before extracting a fresh source
tree. All downloads, output, and Zig caches stay in ignored `dist/`; it never
patches upstream sources or uses the shipped adapter's shared Zig cache. The
first build needs network access for upstream and its Zig dependencies.

To rebuild or rerun individual suites:

```bash
node experiments/libghostty/build.mjs
node --test experiments/libghostty/probe.test.mjs
node --test experiments/libghostty/browser.test.mjs
```

## Findings

The Node suite exercises the public API against the built binary. The browser
suite instantiates that same binary in Chromium, Firefox, and WebKit and checks
callbacks, memory growth, styled graphemes, resize, and snapshot continuation.
The initial run passed all 13 tests on macOS 26 / arm64 with Node 24.20.0,
Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6.

| Capability                    | Evidence             | Result and scope                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public WASM target            | Build and runtime    | Zero imports; 189 exports including ABI metadata and a growable function table. No wterm patches.                                                                                                                                                            |
| Render state                  | Runtime              | Fragmented UTF-8, combining marks, CJK and ZWJ graphemes; cell widths, RGB foreground, curly underline and underline color; cursor position, shape and blink state. Grapheme-width checks enable DEC mode 2027 explicitly.                                   |
| Dirty rows                    | Runtime              | A single-row edit reports partial damage and the affected row; clean state and memory growth work. Dirty-row skipping and production extraction throughput are not measured.                                                                                 |
| Terminal effects              | Runtime              | PTY replies, bell, title and working-directory notifications reach JavaScript; title and cwd values can be read. Reply and bell callbacks also run in all three browsers.                                                                                    |
| History and tracked positions | Runtime              | A reference follows its cell into history, then changes coordinates after width reflow. History graphemes remain readable. Case-insensitive search finds matches across retained history and the active screen.                                              |
| Snapshot recovery             | Runtime              | Both screens, history, bracketed-paste mode, unfinished CSI and split UTF-8 restore correctly. See the constraints below.                                                                                                                                    |
| Application recordings        | Runtime              | Existing Neovim and tmux output/resize events pass their row, cursor, screen and width checkpoints with writes fragmented into seven-byte chunks. This does not drive live applications.                                                                     |
| Kitty graphics                | Runtime and source   | Disabled in this freestanding target. The build-info flag is false; graphics and image-limit getters return `GHOSTTY_NO_VALUE`, even after setting an image budget. **Blocks replacing the shipped adapter.**                                                |
| Discarded history count       | Header review        | Retained row counts and tracked references exist, but no cumulative discarded-row counter equivalent to `getScrollbackDiscardedCount()` was found. The renderer's anchoring contract needs an equivalent signal or a verified replacement.                   |
| Hyperlinks                    | Header review        | `grid_ref.h` exposes the URI. No getter for explicit OSC 8 identity equivalent to `CellData.linkId` / `linkKey` was found. URI equality alone cannot preserve the existing identity contract.                                                                |
| Image resource limits         | Header/source review | The graphics API exposes images, placements and generation, but not wterm's full count/rejection/eviction reporting contract. Upstream storage lacks wterm's explicit 4,096 image and placement caps. Graphics being disabled prevents runtime testing here. |
| Selection and input encoders  | Header review only   | Selection, keyboard and mouse APIs exist. Copy semantics, browser event mapping, IME, pruning behavior and integration are untested.                                                                                                                         |
| Clipboard effects             | Header review only   | Read/write callback protocols exist in `terminal.h`. This probe neither registers them nor accesses the host clipboard.                                                                                                                                      |

The graphics restriction is explicit in upstream
[build_options.zig][graphics-build]. Other comparisons use the pinned
[public headers][headers], upstream
[graphics storage][graphics-storage], and wterm's existing
[`TerminalCore`](../../packages/@wterm/core/src/terminal-core.ts) and
[Ghostty adapter](../../packages/@wterm/ghostty/README.md).

## Snapshot constraints

[snapshot.h][snapshots] defines a CRC-protected binary record stream. The tests
restore both primary and alternate screens plus retained history, resume an
unfinished true-color CSI and a split UTF-8 character, and capture another
snapshot from a restored unfinished parser. A truncated snapshot and a damaged
record are rejected. An unfinished parser cannot be captured when continuation
tracking was disabled.

The bindings enable `CONTINUATION_MAX_BYTES` at 1 MiB before input. Decoding sets
`MAX_CONTINUATION_BYTES` to the same value and `RETAIN_CONTINUATION` to true so
the restored terminal can be captured again before receiving more input. This
limit bounds parser continuation, not the whole terminal or snapshot. Overflow,
incremental history restore, large snapshots and hostile snapshot inputs are
outside this probe's coverage.

Upstream explicitly gives **snapshot format version 1 no binary compatibility
guarantee**. These results apply to the pinned build, not cross-version durable
storage. Host callbacks are attached again after restoration. Snapshots do not
restore a PTY process, WebSocket session or DOM state; supported graphics
recovery also remains unverified because this build has no graphics.

## Binding and lifecycle details

[public-api.mjs](public-api.mjs) reads struct sizes, field offsets and enum values
from `ghostty_type_json()` and checks the wasm32 little-endian ABI. It reacquires
memory views after WASM calls and copies returned strings and snapshot buffers
before releasing their owners. Union decoding exposes all arms; their public
tag determines which arm is meaningful.

Small WASM forwarding functions let JavaScript callbacks enter the exported
function table without `WebAssembly.Function`. Callback slots are cleared and
reused on disposal. Terminal-owned render handles and tracked references are
freed before the terminal, temporary search/decoder handles are scoped, and
snapshot allocations use the matching upstream free function. Disposal is
idempotent; other operations require a live terminal.

These bindings favor inspection over speed: they allocate temporary query
buffers and decode every viewport cell. They are not an optimized render loop
or a complete binding for the public API.

## Artifact size and reports

The initial macOS build produced the same WASM hash from two separate source
locations. Sizes below use Node 24.20.0 `gzipSync` defaults for both binaries:

| Binary                 | Raw bytes | Gzip bytes | SHA-256                                                            |
| ---------------------- | --------: | ---------: | ------------------------------------------------------------------ |
| Pinned public API      |   813,917 |    279,600 | `75f0ed5b23efd554bdbbc695eafb7405e9da0140f47545037d0899ca39ca5c46` |
| Shipped v1.3.1 adapter |   577,013 |    193,312 | `4a0a02357206349ed52b76ebda8feea4a65e453fe4e199832d8c009d7c41ba4f` |

This is a comparison of the actual artifacts with different features and
exports, not a size estimate for a replacement adapter. Reports record the
build environment, including Node/zlib versions, so compression results remain
attributable. `instantiateMs` measures one WASM instantiation plus ABI-metadata
parsing. It excludes download, terminal creation, DOM rendering and PTY startup;
it is not a latency budget or a desktop Ghostty comparison.

Generated files stay under `experiments/libghostty/dist/`:

- `ghostty-vt.wasm`: isolated upstream binary.
- `build.json`: revision, command, environment, sizes, hashes and export count.
- `probe.json`: build metadata, Node environment, check outcomes, fixture hashes,
  instantiation time and final WASM memory size.
- `browsers.json`: build metadata and per-browser versions, outcomes and
  instantiation times.

Tests check that the binary matches the build report's hash. The path-scoped
[Public libghostty API workflow](../../.github/workflows/libghostty.yml) builds
and runs both suites on Linux, caches only the isolated global Zig cache, and
uploads these JSON reports as `public-libghostty-results`. The shipped packages
continue to use the existing adapter until its behavior and resource contracts
can be preserved through the public interface.

[upstream]: https://github.com/ghostty-org/ghostty/tree/7c40388b2c63b7dcc5d6c9b9804e40fb2574444f
[headers]: https://github.com/ghostty-org/ghostty/tree/7c40388b2c63b7dcc5d6c9b9804e40fb2574444f/include/ghostty/vt
[graphics-build]: https://github.com/ghostty-org/ghostty/blob/7c40388b2c63b7dcc5d6c9b9804e40fb2574444f/src/terminal/build_options.zig#L268-L277
[graphics-storage]: https://github.com/ghostty-org/ghostty/blob/7c40388b2c63b7dcc5d6c9b9804e40fb2574444f/src/terminal/kitty/graphics_storage.zig
[snapshots]: https://github.com/ghostty-org/ghostty/blob/7c40388b2c63b7dcc5d6c9b9804e40fb2574444f/include/ghostty/vt/snapshot.h
