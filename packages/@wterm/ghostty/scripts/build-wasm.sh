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
WASM_OUT="${WTERM_GHOSTTY_WASM_OUT:-$OUT_DIR/ghostty-vt.wasm}"

# ---------------------------------------------------------------------------
# 1. Locate Zig 0.16.x (required by ghostty 1.3.2-dev)
# ---------------------------------------------------------------------------
ZIG_CMD=()
if command -v zig &>/dev/null && [[ "$(zig version 2>/dev/null)" =~ ^0\.16\. ]]; then
  ZIG_CMD=(zig)
elif command -v mise &>/dev/null; then
  ZIG_CMD=(mise exec zig@0.16.0 -- zig)
fi

if [[ "${#ZIG_CMD[@]}" -eq 0 ]]; then
  echo "Error: Zig 0.16.x is required but not found."
  echo "Install it with: zigup 0.16.0, mise install zig@0.16.0,"
  echo "or download from https://ziglang.org/download/"
  exit 1
fi

echo "Using Zig: ${ZIG_CMD[*]} ($("${ZIG_CMD[@]}" version))"

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

# The archive is intentionally pinned to the post-#13394 snapshot. Keep this
# check close to the fetch so a source layout or pin mistake fails before a
# potentially misleading compatibility patch/build error.
if ! grep -q 'pub fn clonePartialRowGrowCapacity' "$GHOSTTY_SRC/src/terminal/Screen.zig" ||
  ! grep -q 'current = self.increaseCapacity' "$GHOSTTY_SRC/src/terminal/Screen.zig" ||
  ! grep -q 'current = self.clonePartialRowGrowCapacity' "$GHOSTTY_SRC/src/terminal/Screen.zig"; then
  echo "Error: pinned ghostty source does not contain the page-capacity retry fix"
  exit 1
fi

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
"${ZIG_CMD[@]}" build -Doptimize=ReleaseSmall

mkdir -p "$(dirname "$WASM_OUT")"
cp zig-out/bin/ghostty-vt.wasm "$WASM_OUT"

echo ""
echo "Built: $WASM_OUT"
ls -lh "$WASM_OUT"
