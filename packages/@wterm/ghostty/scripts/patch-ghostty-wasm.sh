#!/bin/bash
# Patches the pinned Ghostty source for wasm32-freestanding compatibility.
#
# The source is extracted into zig/ghostty by build-wasm.sh and is ignored by
# git. This script is deliberately strict: an upstream layout change must
# stop the build instead of producing a partially patched binary.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 GHOSTTY_SOURCE_DIR" >&2
  exit 2
fi

GHOSTTY_SRC="$1"
PAGE_ZIG="$GHOSTTY_SRC/src/terminal/page.zig"
PAGELIST_ZIG="$GHOSTTY_SRC/src/terminal/PageList.zig"

for file in "$PAGE_ZIG" "$PAGELIST_ZIG"; do
  if [[ ! -f "$file" ]]; then
    echo "Error: expected Ghostty source file not found: $file" >&2
    exit 1
  fi
done

python3 - "$PAGELIST_ZIG" "$PAGE_ZIG" <<'PY'
import sys
from pathlib import Path

pagelist_path = Path(sys.argv[1])
page_path = Path(sys.argv[2])


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(
            f"{label}: expected one upstream anchor, found {count}; "
            "the pinned source may be stale or incompatible"
        )
    return source.replace(old, new, 1)


def patch_pagelist(source: str) -> str:
    if "discarded_rows: usize" not in source:
        source = replace_once(
            source,
            "total_rows: usize,\n\n/// The list of tracked pins.",
            "total_rows: usize,\n\ndiscarded_rows: usize,\n\n/// The list of tracked pins.",
            "PageList discarded_rows field",
        )

    if ".discarded_rows = 0" not in source:
        source = replace_once(
            source,
            ".total_rows = rows,\n        .tracked_pins",
            ".total_rows = rows,\n        .discarded_rows = 0,\n        .tracked_pins",
            "PageList initializer",
        )

    if ".discarded_rows = self.discarded_rows" not in source:
        source = replace_once(
            source,
            ".total_rows = total_rows,\n        .tracked_pins",
            ".total_rows = total_rows,\n        .discarded_rows = self.discarded_rows,\n        .tracked_pins",
            "PageList clone initializer",
        )

    if "self.discarded_rows = 0;" not in source:
        source = replace_once(
            source,
            "self.total_rows = self.rows;\n",
            "self.total_rows = self.rows;\n    self.discarded_rows = 0;\n",
            "PageList reset accounting",
        )

    if "self.discarded_rows += first.rows()" not in source:
        source = replace_once(
            source,
            "        // Decrease our total row count from the pruned page\n"
            "        self.total_rows -= first.rows();\n",
            "        // Decrease our total row count from the pruned page\n"
            "        self.total_rows -= first.rows();\n"
            "        self.discarded_rows += first.rows();\n",
            "PageList grow discard accounting",
        )

    if "self.discarded_rows -= first.rows()" not in source:
        source = replace_once(
            source,
            "            self.total_rows += first.rows();\n"
            "            break :prune;",
            "            self.total_rows += first.rows();\n"
            "            self.discarded_rows -= first.rows();\n"
            "            break :prune;",
            "PageList grow rollback accounting",
        )

    if "pagelist.discarded_rows += first_rows" not in source:
        source = replace_once(
            source,
            "            pagelist.erasePage(first);\n"
            "            pagelist.total_rows -= first_rows;\n",
            "            pagelist.erasePage(first);\n"
            "            pagelist.total_rows -= first_rows;\n"
            "            pagelist.discarded_rows += first_rows;\n",
            "PageList limits enforcement accounting",
        )

    if "pub fn discardedRows" not in source:
        source = replace_once(
            source,
            "fn totalRows(self: *const PageList) usize {",
            "pub fn discardedRows(self: *const PageList) usize {\n"
            "    return self.discarded_rows;\n"
            "}\n\n"
            "fn totalRows(self: *const PageList) usize {",
            "PageList discardedRows accessor",
        )

    required = (
        "discarded_rows: usize",
        ".discarded_rows = 0",
        ".discarded_rows = self.discarded_rows",
        "self.discarded_rows = 0;",
        "self.discarded_rows += first.rows()",
        "self.discarded_rows -= first.rows()",
        "pagelist.discarded_rows += first_rows",
        "pub fn discardedRows",
    )
    missing = [marker for marker in required if marker not in source]
    if missing:
        raise SystemExit(f"PageList patch incomplete: {missing}")
    return source


def patch_page(source: str) -> str:
    if "AllocWasm" not in source:
        source = replace_once(
            source,
            "const PageAlloc = switch (builtin.os.tag) {\n"
            "    .windows => AllocWindows,\n"
            "    else => AllocPosix,\n"
            "};",
            "const PageAlloc = if (builtin.target.cpu.arch.isWasm())\n"
            "    AllocWasm\n"
            "else switch (builtin.os.tag) {\n"
            "    .windows => AllocWindows,\n"
            "    else => AllocPosix,\n"
            "};\n\n"
            "/// Allocate page-aligned, zeroed backing memory from the WASM allocator.\n"
            "/// wasm32-freestanding has no mmap; explicit zeroing keeps the invariant.\n"
            "const AllocWasm = struct {\n"
            "    pub fn alloc(n: usize) error{OutOfMemory}![]align(std.heap.page_size_min) u8 {\n"
            "        const backing = std.heap.wasm_allocator.alignedAlloc(\n"
            "            u8,\n"
            "            .fromByteUnits(std.heap.page_size_min),\n"
            "            n,\n"
            "        ) catch return error.OutOfMemory;\n"
            "        @memset(backing, 0);\n"
            "        return backing;\n"
            "    }\n\n"
            "    pub fn free(mem: []align(std.heap.page_size_min) u8) void {\n"
            "        std.heap.wasm_allocator.free(mem);\n"
            "    }\n"
            "};",
            "page PageAlloc switch",
        )

    if "AllocWasm" not in source:
        raise SystemExit("page patch incomplete: AllocWasm was not inserted")

    if "isWasm()) void else std.posix" not in source:
        source = replace_once(
            source,
            "const posix = std.posix;",
            "const posix = if (builtin.target.cpu.arch.isWasm()) void else std.posix;",
            "page POSIX namespace",
        )

    required = (
        "const PageAlloc = if (builtin.target.cpu.arch.isWasm())",
        "const AllocWasm = struct",
        "@memset(backing, 0);",
        "std.heap.wasm_allocator.free(mem);",
        "isWasm()) void else std.posix",
    )
    missing = [marker for marker in required if marker not in source]
    if missing:
        raise SystemExit(f"page patch incomplete: {missing}")
    return source


pagelist_path.write_text(patch_pagelist(pagelist_path.read_text()))
page_path.write_text(patch_page(page_path.read_text()))
print("PageList.zig patched for WASM")
print("page.zig patched for WASM")
PY
