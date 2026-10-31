#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ZIG_DIR="$SCRIPT_DIR/../zig"
ARTIFACT="$SCRIPT_DIR/../wasm/ghostty-vt.wasm"
# shellcheck source-path=SCRIPTDIR
source "$SCRIPT_DIR/zig-toolchain.sh"

MODE="${1:-build}"
if [[ $# -gt 1 || ( "$MODE" != build && "$MODE" != --check ) ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 1
fi

ZIG="${WTERM_GHOSTTY_ZIG:-}"
if [[ -z "$ZIG" ]]; then
  if command -v zig >/dev/null && [[ "$(zig version)" == "$GHOSTTY_ZIG_VERSION" ]]; then
    ZIG="$(command -v zig)"
  elif [[ -x "$HOME/.local/share/zigup/$GHOSTTY_ZIG_VERSION/files/zig" ]]; then
    ZIG="$HOME/.local/share/zigup/$GHOSTTY_ZIG_VERSION/files/zig"
  else
    echo "Zig $GHOSTTY_ZIG_VERSION is required. Set WTERM_GHOSTTY_ZIG to its executable or use rebuild-wasm:docker." >&2
    exit 1
  fi
fi
VERSION="$("$ZIG" version)"
if [[ "$VERSION" != "$GHOSTTY_ZIG_VERSION" ]]; then
  echo "Expected Zig $GHOSTTY_ZIG_VERSION, got $VERSION" >&2
  exit 1
fi
# Resolve a relative override before changing the working directory.
ZIG="$(command -v "$ZIG")"
if [[ "$ZIG" != /* ]]; then ZIG="$PWD/$ZIG"; fi

# build.zig.zon is the source of truth for the upstream URL and content hash.
DEPENDENCY="$(python3 - "$ZIG_DIR/build.zig.zon" <<'PY'
import pathlib, re, sys
manifest = pathlib.Path(sys.argv[1]).read_text()
block = re.search(r'\.ghostty\s*=\s*\.\{([^}]+)\}', manifest)
if not block:
    sys.exit('Missing Ghostty dependency in build.zig.zon')
for key in ('url', 'hash'):
    value = re.search(r'\.' + key + r'\s*=\s*"([^"\n]+)"', block[1])
    if not value:
        sys.exit('Missing Ghostty ' + key + ' in build.zig.zon')
    print(value[1])
PY
)"
GHOSTTY_URL="${DEPENDENCY%%$'\n'*}"
GHOSTTY_HASH="${DEPENDENCY#*$'\n'}"

# Never read or modify a shared Zig package cache. Both compiler caches,
# patched upstream files, and the install prefix belong to this invocation.
TEMP_DIR="$(mktemp -d /tmp/wterm-ghostty-build.XXXXXX)"
trap 'rm -rf "$TEMP_DIR"' EXIT
GLOBAL_CACHE="$TEMP_DIR/global-cache"
echo "Building Ghostty with Zig $VERSION in an isolated cache"
FETCHED_HASH="$("$ZIG" fetch --global-cache-dir "$GLOBAL_CACHE" "$GHOSTTY_URL")"
if [[ "$FETCHED_HASH" != "$GHOSTTY_HASH" ]]; then
  echo "Ghostty dependency hash mismatch: expected $GHOSTTY_HASH, got $FETCHED_HASH" >&2
  exit 1
fi
GHOSTTY_SRC="$GLOBAL_CACHE/p/$GHOSTTY_HASH"
bash "$SCRIPT_DIR/patch-ghostty-wasm.sh" "$GHOSTTY_SRC"
# Verify repeated patching yields exactly the same source, not merely a
# successful exit. This includes .orig files used by the patcher.
cp -R "$GHOSTTY_SRC" "$TEMP_DIR/patched-source"
bash "$SCRIPT_DIR/patch-ghostty-wasm.sh" "$GHOSTTY_SRC"
diff -qr "$TEMP_DIR/patched-source" "$GHOSTTY_SRC"

cd "$ZIG_DIR"
"$ZIG" build -Doptimize=ReleaseSmall \
  --global-cache-dir "$GLOBAL_CACHE" \
  --cache-dir "$TEMP_DIR/local-cache" \
  --prefix "$TEMP_DIR/output"
BUILT="$TEMP_DIR/output/bin/ghostty-vt.wasm"

if [[ "$MODE" == --check ]]; then
  if ! cmp -s "$BUILT" "$ARTIFACT"; then
    echo "Committed ghostty-vt.wasm does not match the pinned source build." >&2
    echo "Run pnpm --filter @wterm/ghostty rebuild-wasm (or rebuild-wasm:docker) and commit the updated binary." >&2
    exit 1
  fi
  echo "Ghostty WASM matches the committed artifact byte for byte."
else
  mkdir -p "$(dirname "$ARTIFACT")"
  cp "$BUILT" "$ARTIFACT"
  echo "Built: $ARTIFACT"
fi
