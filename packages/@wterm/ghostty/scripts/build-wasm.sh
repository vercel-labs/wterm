#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ZIG_DIR="$SCRIPT_DIR/../zig"
OUT_DIR="$SCRIPT_DIR/../wasm"

# ghostty 1.3.2-dev: includes the hyperlink page-capacity fix
# (ghostty-org/ghostty#13394) that is not in any tagged release. Same pin
# zmx 0.7.1 ships with. The zig/build.zig.zon path dependency points at the
# checkout this script creates.
GHOSTTY_COMMIT="8af6897c0afc63037a8a3efee4162a380e3a4572"
GHOSTTY_URL="https://github.com/ghostty-org/ghostty/archive/${GHOSTTY_COMMIT}.tar.gz"
GHOSTTY_SRC="$ZIG_DIR/ghostty"

# ---------------------------------------------------------------------------
# 1. Locate Zig 0.16.x (required by ghostty 1.3.2-dev)
# ---------------------------------------------------------------------------
ZIG=""
if command -v zig &>/dev/null && [[ "$(zig version 2>/dev/null)" =~ ^0\.16\. ]]; then
  ZIG="zig"
elif command -v mise &>/dev/null; then
  ZIG="mise exec zig@0.16.0 -- zig"
fi

if [[ -z "$ZIG" ]]; then
  echo "Error: Zig 0.16.x is required but not found."
  echo "Install it with: zigup 0.16.0, mise install zig@0.16.0,"
  echo "or download from https://ziglang.org/download/"
  exit 1
fi

echo "Using Zig: $ZIG ($($ZIG version))"

# ---------------------------------------------------------------------------
# 2. Fetch and extract ghostty source (kept out of git; see .gitignore)
# ---------------------------------------------------------------------------
if [[ ! -f "$GHOSTTY_SRC/.commit" || "$(cat "$GHOSTTY_SRC/.commit")" != "$GHOSTTY_COMMIT" ]]; then
  echo "Fetching ghostty @ ${GHOSTTY_COMMIT}..."
  rm -rf "$GHOSTTY_SRC"
  mkdir -p "$GHOSTTY_SRC"
  curl -fsSL "$GHOSTTY_URL" | tar -xz -C "$GHOSTTY_SRC" --strip-components=1
  echo "$GHOSTTY_COMMIT" > "$GHOSTTY_SRC/.commit"
fi

echo "ghostty source: $GHOSTTY_SRC"

# ---------------------------------------------------------------------------
# 3. Patch for wasm32-freestanding (page allocator, discarded-rows counter)
# ---------------------------------------------------------------------------
echo "Applying WASM patches..."
bash "$SCRIPT_DIR/patch-ghostty-wasm.sh" "$GHOSTTY_SRC"

# ---------------------------------------------------------------------------
# 4. Build
# ---------------------------------------------------------------------------
cd "$ZIG_DIR"
echo "Building ghostty-vt WASM module..."
$ZIG build -Doptimize=ReleaseSmall

mkdir -p "$OUT_DIR"
cp zig-out/bin/ghostty-vt.wasm "$OUT_DIR/"

echo ""
echo "Built: $OUT_DIR/ghostty-vt.wasm"
ls -lh "$OUT_DIR/ghostty-vt.wasm"
