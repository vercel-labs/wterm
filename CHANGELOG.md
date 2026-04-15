# Changelog

## 0.1.5

<!-- release:start -->

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

<!-- release:end -->

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
