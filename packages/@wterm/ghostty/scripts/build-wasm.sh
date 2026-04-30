#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ZIG_DIR="$SCRIPT_DIR/../zig"
OUT_DIR="$SCRIPT_DIR/../wasm"

GHOSTTY_VERSION="1.3.1"
GHOSTTY_URL="https://github.com/ghostty-org/ghostty/archive/v${GHOSTTY_VERSION}.tar.gz"
GHOSTTY_HASH="ghostty-${GHOSTTY_VERSION}-5UdBCwYm-gQeBa4bu1-sMooCQS4KVriv5wWSIJ_sI-Cb"

# ---------------------------------------------------------------------------
# 1. Locate Zig 0.15.x
# ---------------------------------------------------------------------------
ZIG=""
ZIGUP_PATH="$HOME/.local/share/zigup/0.15.2/files/zig"
if [[ -x "$ZIGUP_PATH" ]]; then
  ZIG="$ZIGUP_PATH"
elif command -v zig &>/dev/null && [[ "$(zig version 2>/dev/null)" =~ ^0\.15\. ]]; then
  ZIG="zig"
fi

if [[ -z "$ZIG" ]]; then
  echo "Error: Zig 0.15.x is required but not found."
  echo ""
  echo "ghostty requires Zig 0.15.x which differs from wterm's Zig 0.16.x."
  echo "Install it with: zigup 0.15.2"
  echo "or download from https://ziglang.org/download/"
  exit 1
fi

echo "Using Zig: $ZIG ($($ZIG version))"

# ---------------------------------------------------------------------------
# 2. Ensure ghostty source is fetched (populate Zig global cache)
# ---------------------------------------------------------------------------
GHOSTTY_SRC="$HOME/.cache/zig/p/$GHOSTTY_HASH"

if [[ ! -d "$GHOSTTY_SRC" ]]; then
  echo "Fetching ghostty v${GHOSTTY_VERSION}..."
  cd "$ZIG_DIR"
  "$ZIG" build 2>/dev/null || true
  if [[ ! -d "$GHOSTTY_SRC" ]]; then
    echo "Error: ghostty source not found at $GHOSTTY_SRC after fetch"
    exit 1
  fi
fi

echo "ghostty source: $GHOSTTY_SRC"

# ---------------------------------------------------------------------------
# 3. Patch page.zig for WASM (mmap → wasm_allocator)
# ---------------------------------------------------------------------------
echo "Applying WASM patches..."
bash "$SCRIPT_DIR/patch-ghostty-wasm.sh" "$GHOSTTY_SRC"

# ---------------------------------------------------------------------------
# 4. Build
# ---------------------------------------------------------------------------
cd "$ZIG_DIR"
echo "Building ghostty-vt WASM module..."
"$ZIG" build -Doptimize=ReleaseSmall

mkdir -p "$OUT_DIR"
cp zig-out/bin/ghostty-vt.wasm "$OUT_DIR/"

echo ""
echo "Built: $OUT_DIR/ghostty-vt.wasm"
ls -lh "$OUT_DIR/ghostty-vt.wasm"
