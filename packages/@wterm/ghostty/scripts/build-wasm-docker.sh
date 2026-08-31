#!/bin/bash
# Runs build-wasm.sh inside a Linux container.
#
# Local convenience only — CI and the committed artifact are unaffected. Use
# this when the host toolchain cannot build: Zig 0.15.x (required by ghostty
# 1.3.1) fails to link a native build runner on macOS 26, and Zig 0.16 fails
# inside ghostty's vendored build files, so neither can drive build-wasm.sh
# there. The wasm build itself is fine; only the host-native steps break.
#
# The output is byte-identical to a working host build, so a container build
# can be committed like any other.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../../.." && pwd)"
PKG_REL="${PKG_DIR#"$REPO_ROOT"/}"

ZIG_VERSION="0.15.2"
IMAGE="alpine:3.20"

if ! command -v docker &>/dev/null; then
  echo "Error: docker is required. Build on a host with a working Zig ${ZIG_VERSION} instead."
  exit 1
fi

case "$(uname -m)" in
  arm64 | aarch64) ZIG_ARCH="aarch64" ;;
  x86_64) ZIG_ARCH="x86_64" ;;
  *)
    echo "Error: unsupported architecture $(uname -m)."
    exit 1
    ;;
esac

# python3 is required by patch-ghostty-wasm.sh.
docker run --rm \
  -v "$REPO_ROOT:/work" \
  -e ZIG_VERSION="$ZIG_VERSION" \
  -e ZIG_ARCH="$ZIG_ARCH" \
  -e PKG_REL="$PKG_REL" \
  "$IMAGE" sh -euc '
    apk add --no-cache curl xz bash python3 >/dev/null
    cd /tmp
    ZIG_DIR="zig-${ZIG_ARCH}-linux-${ZIG_VERSION}"
    curl -sSfL -o zig.tar.xz "https://ziglang.org/download/${ZIG_VERSION}/${ZIG_DIR}.tar.xz"
    tar -xJf zig.tar.xz
    export PATH="/tmp/${ZIG_DIR}:$PATH"
    cd "/work/${PKG_REL}"
    bash scripts/build-wasm.sh
  '
