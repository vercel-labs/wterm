# Changelog

## 0.1.8

<!-- release:start -->

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

<!-- release:end -->

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
