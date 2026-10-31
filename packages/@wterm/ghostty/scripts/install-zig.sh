#!/bin/bash
# Install the checksum-verified Linux build toolchain in a new directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR
source "$SCRIPT_DIR/zig-toolchain.sh"

if [[ $# != 1 ]]; then
  echo "Usage: $0 <new-install-directory>" >&2
  exit 1
fi
if [[ "$(uname -s)" != Linux ]]; then
  echo "This installer supports Linux. Use rebuild-wasm:docker on macOS." >&2
  exit 1
fi
case "$(uname -m)" in
  x86_64) ZIG_ARCH=x86_64; ZIG_SHA256="$GHOSTTY_ZIG_X86_64_SHA256" ;;
  aarch64 | arm64) ZIG_ARCH=aarch64; ZIG_SHA256="$GHOSTTY_ZIG_AARCH64_SHA256" ;;
  *) echo "Unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
esac

# Refuse to overwrite an existing installation. Downloads/extraction stay in
# an owned temporary directory until the checksum and version both pass.
DESTINATION="$1"
if [[ -e "$DESTINATION" || -L "$DESTINATION" ]]; then
  echo "Install directory already exists: $DESTINATION" >&2
  exit 1
fi
TEMP_DIR="$(mktemp -d /tmp/wterm-ghostty-zig.XXXXXX)"
trap 'rm -rf "$TEMP_DIR"' EXIT
ARCHIVE="zig-${ZIG_ARCH}-linux-${GHOSTTY_ZIG_VERSION}"
curl --fail --silent --show-error --location --retry 3 \
  "https://ziglang.org/download/${GHOSTTY_ZIG_VERSION}/${ARCHIVE}.tar.xz" \
  --output "$TEMP_DIR/zig.tar.xz"
printf '%s  %s\n' "$ZIG_SHA256" "$TEMP_DIR/zig.tar.xz" | sha256sum -c
tar -xJf "$TEMP_DIR/zig.tar.xz" -C "$TEMP_DIR"
if [[ "$("$TEMP_DIR/$ARCHIVE/zig" version)" != "$GHOSTTY_ZIG_VERSION" ]]; then
  echo "Downloaded Zig version does not match $GHOSTTY_ZIG_VERSION" >&2
  exit 1
fi
mkdir -p "$(dirname "$DESTINATION")"
mv "$TEMP_DIR/$ARCHIVE" "$DESTINATION"
echo "Installed Zig $GHOSTTY_ZIG_VERSION at $DESTINATION"
