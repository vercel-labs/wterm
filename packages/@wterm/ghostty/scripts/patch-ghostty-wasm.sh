#!/bin/bash
# Patches ghostty source for wasm32-freestanding compatibility.
#
# Two files need patching:
#   1. page.zig — page backing memory comes from mmap (POSIX) or
#      VirtualAlloc (Windows); neither exists on WASM. Adds an AllocWasm
#      variant backed by wasm_allocator to the PageAlloc switch.
#   2. PageList.zig — adds a discarded_rows counter so @wterm/dom can keep
#      retained history anchored when the page budget rolls over. Counts
#      both eviction paths: grow()'s prune-and-reuse and limits
#      enforcement's automatic pruning.
#
# Pinned to ghostty 1.3.2-dev (8af6897) — verify after version bumps.
set -euo pipefail

GHOSTTY_SRC="$1"
PAGE_ZIG="$GHOSTTY_SRC/src/terminal/page.zig"
PAGELIST_ZIG="$GHOSTTY_SRC/src/terminal/PageList.zig"

if [[ ! -f "$PAGE_ZIG" ]]; then
  echo "Error: $PAGE_ZIG not found"
  exit 1
fi

[[ -f "$PAGE_ZIG.orig" ]] || cp "$PAGE_ZIG" "$PAGE_ZIG.orig"
[[ -f "$PAGELIST_ZIG.orig" ]] || cp "$PAGELIST_ZIG" "$PAGELIST_ZIG.orig"

# ---------------------------------------------------------------
# Patch PageList.zig — discarded_rows counter
# ---------------------------------------------------------------
python3 -c "
with open('$PAGELIST_ZIG', 'r') as f:
    src = f.read()

if 'discarded_rows: usize' not in src:
    src = src.replace(
        'total_rows: usize,\\n\\n/// The list of tracked pins.',
        'total_rows: usize,\\n\\ndiscarded_rows: usize,\\n\\n/// The list of tracked pins.',
        1,
    )

if '.discarded_rows = 0' not in src:
    src = src.replace(
        '.total_rows = rows,\\n        .tracked_pins',
        '.total_rows = rows,\\n        .discarded_rows = 0,\\n        .tracked_pins',
        1,
    )

if '.discarded_rows = self.discarded_rows' not in src:
    src = src.replace(
        '.total_rows = total_rows,\\n        .tracked_pins',
        '.total_rows = total_rows,\\n        .discarded_rows = self.discarded_rows,\\n'
        '        .tracked_pins',
        1,
    )

if 'self.discarded_rows = 0;' not in src:
    src = src.replace(
        'self.total_rows = self.rows;\\n',
        'self.total_rows = self.rows;\\n    self.discarded_rows = 0;\\n',
        1,
    )

# grow(): prune-and-reuse of the oldest page when the byte budget is hit.
if 'self.discarded_rows += first.rows()' not in src:
    src = src.replace(
        '        // Decrease our total row count from the pruned page\\n'
        '        self.total_rows -= first.rows();\\n',
        '        // Decrease our total row count from the pruned page\\n'
        '        self.total_rows -= first.rows();\\n'
        '        self.discarded_rows += first.rows();\\n',
        1,
    )

if 'self.discarded_rows -= first.rows()' not in src:
    src = src.replace(
        '            self.total_rows += first.rows();\\n'
        '            break :prune;',
        '            self.total_rows += first.rows();\\n'
        '            self.discarded_rows -= first.rows();\\n'
        '            break :prune;',
        1,
    )

# Limits enforcement: automatic pruning of whole history pages.
if 'pagelist.discarded_rows += first_rows' not in src:
    src = src.replace(
        '            pagelist.erasePage(first);\\n'
        '            pagelist.total_rows -= first_rows;\\n',
        '            pagelist.erasePage(first);\\n'
        '            pagelist.total_rows -= first_rows;\\n'
        '            pagelist.discarded_rows += first_rows;\\n',
        1,
    )

if 'pub fn discardedRows' not in src:
    src = src.replace(
        'fn totalRows(self: *const PageList) usize {',
        'pub fn discardedRows(self: *const PageList) usize {\\n'
        '    return self.discarded_rows;\\n'
        '}\\n\\nfn totalRows(self: *const PageList) usize {',
        1,
    )

required = [
    'discarded_rows: usize',
    '.discarded_rows = 0',
    '.discarded_rows = self.discarded_rows',
    'self.discarded_rows = 0;',
    'self.discarded_rows += first.rows()',
    'self.discarded_rows -= first.rows()',
    'pagelist.discarded_rows += first_rows',
    'pub fn discardedRows',
]
missing = [needle for needle in required if needle not in src]
if missing:
    raise SystemExit(f'PageList scrollback patch failed: {missing}')

with open('$PAGELIST_ZIG', 'w') as f:
    f.write(src)

print('PageList.zig patched for WASM')
"

# ---------------------------------------------------------------
# Patch page.zig — WASM page allocator
# ---------------------------------------------------------------
python3 -c "
with open('$PAGE_ZIG', 'r') as f:
    src = f.read()

old_switch = '''const PageAlloc = switch (builtin.os.tag) {
    .windows => AllocWindows,
    else => AllocPosix,
};'''

new_switch = '''const PageAlloc = if (builtin.target.cpu.arch.isWasm())
    AllocWasm
else switch (builtin.os.tag) {
    .windows => AllocWindows,
    else => AllocPosix,
};

/// Allocate page-aligned, zeroed backing memory from the WASM allocator.
/// wasm32-freestanding has no mmap; explicit zeroing keeps the invariant.
const AllocWasm = struct {
    pub fn alloc(n: usize) error{OutOfMemory}![]align(std.heap.page_size_min) u8 {
        const backing = std.heap.wasm_allocator.alignedAlloc(
            u8,
            .fromByteUnits(std.heap.page_size_min),
            n,
        ) catch return error.OutOfMemory;
        @memset(backing, 0);
        return backing;
    }

    pub fn free(mem: []align(std.heap.page_size_min) u8) void {
        std.heap.wasm_allocator.free(mem);
    }
};'''

if 'AllocWasm' not in src:
    src = src.replace(old_switch, new_switch, 1)

if 'AllocWasm' not in src:
    raise SystemExit('page.zig PageAlloc patch failed: switch not found')

# posix/windows namespaces must not be resolved on WASM.
if 'isWasm()) void else std.posix' not in src:
    src = src.replace(
        'const posix = std.posix;',
        'const posix = if (builtin.target.cpu.arch.isWasm()) void else std.posix;',
        1,
    )

with open('$PAGE_ZIG', 'w') as f:
    f.write(src)

print('page.zig patched for WASM')
"
