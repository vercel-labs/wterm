# Changelog

## 0.1.3

<!-- release:start -->

### Improvements

- **Embedded WASM binary** — the ~12 KB WASM binary is now base64-inlined into the JS bundle, eliminating the need to copy and serve `wterm.wasm` as a static asset. `wasmUrl` is now optional and only needed when serving the binary separately for caching or CDN use.
- Updated **docs and READMEs** to reflect the zero-setup WASM approach

### Bug Fixes

- Fixed **renderer formatting** — minor code style cleanup in the DOM renderer

### Contributors

- @ctate

<!-- release:end -->

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
