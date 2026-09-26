#!/bin/bash
# Linux fallback for hosts unable to run Ghostty's pinned Zig build runner.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../../.." && pwd)"
PKG_REL="${PKG_DIR#"$REPO_ROOT"/}"

if [[ $# -gt 1 || ( $# == 1 && "$1" != --check ) ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 1
fi
if ! command -v docker >/dev/null; then
  echo "Docker is required for this build. See the @wterm/ghostty README." >&2
  exit 1
fi

# Keep host caches and toolchains out of the container. Check mode can run
# with a read-only checkout because every generated file belongs in /tmp.
MOUNT_MODE=rw
if [[ "${1:-}" == --check ]]; then MOUNT_MODE=ro; fi
docker run --rm \
  -v "$REPO_ROOT:/work:$MOUNT_MODE" \
  -e PKG_REL="$PKG_REL" \
  alpine:3.20 sh -euc '
    apk add --no-cache curl xz bash python3 diffutils >/dev/null
    cd "/work/$PKG_REL"
    bash scripts/install-zig.sh /tmp/ghostty-zig
    export WTERM_GHOSTTY_ZIG=/tmp/ghostty-zig/zig
    bash scripts/build-wasm.sh "$@"
  ' ghostty-build "$@"
