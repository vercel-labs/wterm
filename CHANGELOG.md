# Changelog

## 0.1.2

<!-- release:start -->

### Bug Fixes

- Fixed **block element rendering** — Unicode block characters (U+2580–U+259F) now render correctly using CSS gradients and quadrant compositing instead of font glyphs
- Improved **PTY error handling** — shell spawn failures are now caught gracefully with a user-facing error message before closing the connection

### Improvements

- Removed rounded corners in the local example for a cleaner full-screen look

<!-- release:end -->

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
