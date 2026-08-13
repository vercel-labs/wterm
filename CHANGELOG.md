# Changelog

## 0.3.4

<!-- release:start -->

### New Features

- **Native OSC 8 hyperlinks:** the built-in and Ghostty cores preserve hyperlink metadata through rendering, scrollback, reflow and resets. The DOM renderer exposes safe absolute HTTP(S) links as native anchors, with Command-click activation on macOS and Control-click on Windows/Linux while plain clicks remain terminal-owned (#116)

### Bug Fixes

- **Complete Ghostty grapheme strings:** combining marks and ZWJ sequences now cross the WASM boundary as complete clusters in both the viewport and scrollback instead of being truncated to a base codepoint (#111)
- **Ghostty theme color responses:** OSC 10 and OSC 11 queries now return the configured foreground and background colors with the original BEL or ST terminator (#113)
- **Atomic Ghostty synchronized output:** Ghostty exposes DEC mode `?2026` state and block generations so the DOM scheduler holds intermediate frames and paints the completed burst once (#114)
- **Bounded scrollback DOM:** history rows are virtualized with viewport overscan, preserving native selection and the visible history position across rollover and resize while keeping mounted rows bounded (#115, #61)

### Improvements

- **Direct animation-frame scheduling:** normal writes request an animation frame without an intermediate timer while retaining one pending render per frame and synchronized-output cancellation semantics (#112)

### Contributors

- @Railly

<!-- release:end -->

## 0.3.3

### Bug Fixes

- **Pixel-aligned block gradients** — vertical fractional block glyphs now snap their gradient stops to whole pixels, preventing horizontal rules from jogging between cells at fractional row-height boundaries (#104, #81)
- **Ordered terminal query responses** — the built-in core queues every response instead of overwriting a single pending value, and the DOM adapter drains them in order even when writes arrive in chunks or an `onData` callback throws (#105)
- **Atomic synchronized output** — DEC mode `?2026` now holds intermediate paints and exposes one completed frame, with a fixed one-second recovery ceiling for unterminated blocks and generation-aware deadlines for consecutive blocks (#106, #57)
- **Browser mouse and focus reporting** — the DOM adapter now emits SGR press, drag, release and wheel events for modes `1000`, `1002` and `1006`, reports focus for mode `1004`, and preserves native Shift selection (#107, #55)
- **Viewport history across vertical resize** — shrinking pushes only the rows above the cursor into scrollback, growing refills from the newest history, and wrapped rings are indexed from their write position. Growing now consumes restored scrollback rows, so `getLine` offsets can shift across a resize and hosts retaining an offset must re-read it (#108, #43, #89)
- **Terminal responses in `@wterm/ghostty`** — DA1, DSR operating status, CPR and DECRQM queries now produce ordered responses through a bounded FIFO instead of being silently dropped (#109)

### Contributors

- @ivebenfreed
- @Ramalama2
- @Railly

## 0.3.2

### Bug Fixes

- **Wide characters occupied one cell** — CJK, fullwidth forms and emoji painted two columns while the grid gave them one, so every occurrence pushed the rest of the row right and cursor-addressed redraws landed a column early. `CellData` gains `width`, the core advances by it, and the DOM renderer skips continuation cells (#102, #54, #71, #101)
- **Blank scrollback in `@wterm/ghostty`** — `get_scrollback_line` was an unimplemented stub returning 0, so every scrolled-back row rendered empty even though the row count was correct (#98)
- **Style leaking across screens** — `get_viewport` read `RenderState.Cell.style` without checking `style_id`, resurfacing the style of whatever occupied the cell in an earlier render pass, including one against the alternate screen (#96)
- **`GhosttyCore.load()` under bundlers that inline modules** — Bun's dev server resolves `import.meta.url` to a path on the build machine, so a `file:` URL reached the browser and `fetch` reported only `Failed to fetch`. The loader now names the cause and points at `wasmPath`, and reports a non-OK response or a non-WASM body instead of failing inside `WebAssembly.instantiate` (#99)
- **`scrollbackLimit` documented as lines** — ghostty reads it as a byte budget, so an 80-column terminal retains about 1150 rows at the 10000 default, not 10000 (#98)
- **Cell width guessed by Unicode block** — hand-written ranges called 1209 assigned characters wide that Unicode calls narrow, including enclosed alphanumerics, domino tiles and several arrow blocks. The table is generated from East Asian Width data now (#102)
- **Wide pairs split at a narrower width** — a row dropped into scrollback during a resize kept a wide cell whose continuation was left behind, and a scrollback row read into a narrower grid spilled a column past its end (#102)

### Improvements

- **`@wterm/ghostty/ghostty-vt.wasm` subpath export** — the binary is now addressable through the package, so apps on bundlers that cannot resolve the default can serve it themselves (#99)
- **Container WASM build** — `rebuild-wasm:docker` runs the existing build script in Linux, for hosts where Zig 0.15.x cannot link a native build runner. Output is byte-identical to a host build (#98)

### Contributors

- @ctate
- @njbrake
- @Railly

## 0.3.1

### Bug Fixes

- **WASM view invalidation** — cached `DataView` and `Uint8Array` views over WASM memory became detached when the module grew memory mid-call, throwing on `getCell`, `getScrollbackCell` and multi-chunk `writeRaw` (#92)
- **Scrollback colors in `@wterm/ghostty`** — `getScrollbackCell()` packed `fgRgb`/`bgRgb` regardless of `colorFlags`, so cells with no explicit color rendered black instead of the terminal default (#93)
- **`escapeHTML` double quotes** — the DOM renderer's escape helper left `"` unescaped (#94)

### Improvements

- **Test coverage for `@wterm/ghostty`** — the package had no test setup, so `turbo run test` skipped it entirely. It now runs in CI like the other packages (#93)

### Contributors

- @hobostay
- @Railly

## 0.3.0

### New Features

- **Ghostty core** — new `@wterm/ghostty` package with `GhosttyCore` implementing `TerminalCore` via libghostty compiled to WASM, providing an alternative terminal rendering engine (#62)
- **`TerminalCore` interface** — extracted into a standalone module in `@wterm/core` so custom cores (like Ghostty) can be swapped in cleanly (#62)
- **Ghostty example** — minimal vanilla TypeScript example using `@wterm/ghostty` and `@wterm/dom` (#62)
- **Ghostty docs page** — install, quick start, how it works, and switching cores guide (#62)

### Improvements

- **Write coalescing** — output writes are now batched with `setTimeout` in the DOM renderer to reduce animation flashing (#62)
- **innerHTML renderer** — switched to `innerHTML` for fewer DOM operations per frame (#62)
- **Deferred PTY spawn** — PTY is now spawned on first `RESIZE` event to eliminate the stray `zsh %` artifact (#62)
- **Local example routes** — split into `/` (built-in core) and `/ghostty` with a core toggle (#62)

### Contributors

- @ctate

## 0.2.1

### Bug Fixes

- Fixed **npm publish** — `workspace:*` peer dependencies are now resolved to real version ranges in published tarballs (#58)
- Fixed **Vue package missing from releases** — `@wterm/vue` is now included in the release workflow (#58)

### Contributors

- @ctate

## 0.2.0

### New Features

- **Vue support** — added `@wterm/vue` package with `<Terminal />` component, `useTerminal` composable, auto-echo when `onData` is omitted, and `debug` prop (#30, #46)

### Improvements

- **Trusted publisher releases** — CI now uses trusted publisher workflow for npm publishing (#45)

### Contributors

- @ctate
- @posva

## 0.1.9

### Bug Fixes

- Fixed **background rendering** not applying correctly (#34)
- Fixed **bracketed paste security** — ESC bytes are now stripped from pasted content to prevent escape sequence injection (#33)
- Fixed **Zig version** in build configuration (#28)

### Contributors

- @aaronjmars
- @ctate

## 0.1.8

### New Features

- **E2E browser tests** — added Playwright test suite with 11 tests covering rendering, keyboard input, focus, cursor movement, scrollback, and resize (#25)
- **Vite example** — minimal vanilla TypeScript terminal with `@wterm/dom` and `@wterm/just-bash`, no framework needed (#24)
- **Markdown Streaming example** — Next.js app using `@wterm/react`, `@wterm/markdown`, and AI SDK to stream LLM output into a terminal (#24)
- **API Reference page** — single consolidated reference for all terminal options, React props, WTerm methods, imperative handle, WebSocketTransport, and WasmBridge (#25)
- **Just Bash docs** — install, quick start, options, virtual FS, network access, and keyboard shortcuts (#23)
- **Markdown docs** — streaming examples (vanilla + React), supported syntax, and LLM output guide (#23)
- **Core / Advanced docs** — WasmBridge API, types, headless example, and WebSocketTransport with remote shell example (#23)

### Improvements

- **Zig 0.16.0** — migrated build system and rebuilt `wterm.wasm` with Zig 0.16.0
- **Vitest workspace** — 165 unit tests across all five packages with V8 coverage and Turbo integration (#21)
- **Zig CI** — added Zig test step and WASM drift check to CI workflow (#22)
- **WTerm integration tests** — 33 tests for the DOM orchestrator (#22)

### Bug Fixes

- Fixed **just-bash README** — corrected broken usage example (#22)

### Contributors

- @ctate

## 0.1.7

### Improvements

- **Zero-boilerplate usage** — `<Terminal />` and `new WTerm(el)` now work out of the box with no `onData` wiring required. When `onData` is omitted, typed input is echoed back automatically (#16)
- **Simpler getting-started examples** — docs, READMEs, and configuration pages updated to show the minimal one-liner usage first, with `onData` / `useTerminal` documented as an advanced pattern (#16, #17)
- **Faster docs layout** — removed server-side cookie reads from the root layout, making it synchronous; chat panel state is now fully client-driven via `useSyncExternalStore`

### Contributors

- @ctate

## 0.1.6

### Bug Fixes

- Fixed **terminal height** — replaced `maxHeight` with deterministic `height` computed from `rows * rowHeight`, preventing layout drift caused by `getBoundingClientRect()` timing
- Fixed **border rendering** — switched docs terminal borders from CSS `border` to `inset box-shadow` to avoid border-width interference with height calculations

### Improvements

- **Row height variable** — added `--term-row-height` CSS custom property so row and block heights are defined in one place

### Contributors

- @ctate

## 0.1.5

### Bug Fixes

- Fixed **Shift key** producing input in the terminal when pressed alone
- Fixed **focus scroll** — focusing the terminal no longer causes unwanted page scroll
- Fixed **height lock** — `maxHeight` calculation now accounts for `border-box` sizing and border widths

### Improvements

- **Docs tables** — option/property tables on the Vanilla and React pages now use proper HTML `<table>` elements
- **Docs routing** — the introduction page is now served at `/` with a redirect from `/introduction`
- **Star count cache** — reduced GitHub star count revalidation interval from 24 hours to 1 hour

### Contributors

- @ctate

## 0.1.4

### Bug Fixes

- Fixed **caret focus state** — the cursor now correctly shows/hides based on terminal focus
- Fixed **paste handling** — clipboard paste works reliably in the terminal
- Fixed **Ctrl+A and Ctrl+E** — jump-to-start and jump-to-end key bindings now work correctly
- Fixed **left/right arrow keys** in the just-bash package for proper cursor movement
- Fixed **Cmd+A** — select-all support in the terminal
- Fixed **clear line** — Ctrl+U now properly clears the current input line

### Improvements

- **Line buffering** — input is now buffered per-line for more accurate editing and replay
- Fixed **broken links** in docs and package READMEs

### Contributors

- @ctate

## 0.1.3

### Improvements

- **Embedded WASM binary** — the ~12 KB WASM binary is now base64-inlined into the JS bundle, eliminating the need to copy and serve `wterm.wasm` as a static asset. `wasmUrl` is now optional and only needed when serving the binary separately for caching or CDN use.
- Updated **docs and READMEs** to reflect the zero-setup WASM approach

### Bug Fixes

- Fixed **renderer formatting** — minor code style cleanup in the DOM renderer

### Contributors

- @ctate

## 0.1.2

### Bug Fixes

- Fixed **block element rendering** — Unicode block characters (U+2580–U+259F) now render correctly using CSS gradients and quadrant compositing instead of font glyphs
- Improved **PTY error handling** — shell spawn failures are now caught gracefully with a user-facing error message before closing the connection

### Improvements

- Removed rounded corners in the local example for a cleaner full-screen look

## 0.1.1

### Bug Fixes

- Fixed **scroll** not working correctly
- Fixed **click focus** triggering when text is selected

### Improvements

- Styled **greeting message** with dim text formatting
- Refactored greeting message internals
- Included `wterm.wasm` as a static asset in package configuration
- Added release process workflow

## 0.1.0

Initial release.
