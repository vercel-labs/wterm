#!/bin/bash
# Patches ghostty source for wasm32-freestanding compatibility.
#
# Two files need patching:
#   1. page.zig — uses posix.mmap/munmap for page memory
#   2. PageList.zig — pageAllocator() returns Mach VM allocator on macOS
#
# Both are replaced with wasm_allocator on WASM targets using
# comptime isWasm() checks, matching ghostty's own conditional style.
#
# Pinned to ghostty v1.3.1 — verify after version bumps.
set -euo pipefail

GHOSTTY_SRC="$1"
PAGE_ZIG="$GHOSTTY_SRC/src/terminal/page.zig"
PAGELIST_ZIG="$GHOSTTY_SRC/src/terminal/PageList.zig"

if [[ ! -f "$PAGE_ZIG" ]]; then
  echo "Error: $PAGE_ZIG not found"
  exit 1
fi

# Skip if already patched
if grep -q 'wasm_page_alloc' "$PAGE_ZIG" 2>/dev/null; then
  echo "Already patched, skipping"
  exit 0
fi

cp "$PAGE_ZIG" "$PAGE_ZIG.orig"
cp "$PAGELIST_ZIG" "$PAGELIST_ZIG.orig"

# ---------------------------------------------------------------
# Patch PageList.zig — pageAllocator()
# ---------------------------------------------------------------
python3 -c "
with open('$PAGELIST_ZIG', 'r') as f:
    src = f.read()

old_pa = '''inline fn pageAllocator() Allocator {
    // In tests we use our testing allocator so we can detect leaks.
    if (builtin.is_test) return std.testing.allocator;

    // On non-macOS we use our standard Zig page allocator.
    if (!builtin.target.os.tag.isDarwin()) return std.heap.page_allocator;

    // On macOS we want to tag our memory so we can assign it to our
    // core terminal usage.
    const mach = @import(\"../os/mach.zig\");
    return mach.taggedPageAllocator(.application_specific_1);
}'''

new_pa = '''inline fn pageAllocator() Allocator {
    if (builtin.is_test) return std.testing.allocator;
    if (comptime builtin.target.cpu.arch.isWasm()) {
        return std.heap.wasm_allocator;
    } else if (comptime builtin.target.os.tag.isDarwin()) {
        const mach = @import(\"../os/mach.zig\");
        return mach.taggedPageAllocator(.application_specific_1);
    } else {
        return std.heap.page_allocator;
    }
}'''

src = src.replace(old_pa, new_pa, 1)

with open('$PAGELIST_ZIG', 'w') as f:
    f.write(src)

print('PageList.zig patched for WASM')
"

# ---------------------------------------------------------------
# Patch page.zig — mmap/munmap
# ---------------------------------------------------------------
python3 -c "
import sys

with open('$PAGE_ZIG', 'r') as f:
    src = f.read()

# 1. Make posix conditional — void on WASM so no symbols are resolved
src = src.replace(
    'const posix = std.posix;',
    'const posix = if (builtin.target.cpu.arch.isWasm()) void else std.posix;',
    1
)

# 2. Patch init() to branch on WASM
old_init = '''    pub inline fn init(cap: Capacity) !Page {
        const l = layout(cap);

        // We use mmap directly to avoid Zig allocator overhead
        // (small but meaningful for this path) and because a private
        // anonymous mmap is guaranteed on Linux and macOS to be zeroed,
        // which is a critical property for us.
        assert(l.total_size % std.heap.page_size_min == 0);
        const backing = try posix.mmap(
            null,
            l.total_size,
            posix.PROT.READ | posix.PROT.WRITE,
            .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
            -1,
            0,
        );
        errdefer posix.munmap(backing);

        const buf = OffsetBuf.init(backing);
        return initBuf(buf, l);
    }'''

new_init = '''    // wasm_page_alloc: patched by @wterm/ghostty for WASM compatibility
    pub inline fn init(cap: Capacity) !Page {
        const l = layout(cap);

        if (comptime builtin.target.cpu.arch.isWasm()) {
            const backing = std.heap.wasm_allocator.alignedAlloc(
                u8,
                std.heap.page_size_min,
                l.total_size,
            ) catch return error.OutOfMemory;
            @memset(backing, 0);
            const buf = OffsetBuf.init(backing);
            return initBuf(buf, l);
        }

        assert(l.total_size % std.heap.page_size_min == 0);
        const backing = try posix.mmap(
            null,
            l.total_size,
            posix.PROT.READ | posix.PROT.WRITE,
            .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
            -1,
            0,
        );
        errdefer posix.munmap(backing);

        const buf = OffsetBuf.init(backing);
        return initBuf(buf, l);
    }'''

src = src.replace(old_init, new_init, 1)

# 3. Patch deinit()
old_deinit = '''    pub inline fn deinit(self: *Page) void {
        posix.munmap(self.memory);
        self.* = undefined;
    }'''

new_deinit = '''    pub inline fn deinit(self: *Page) void {
        if (comptime builtin.target.cpu.arch.isWasm()) {
            std.heap.wasm_allocator.free(self.memory);
        } else {
            posix.munmap(self.memory);
        }
        self.* = undefined;
    }'''

src = src.replace(old_deinit, new_deinit, 1)

# 4. Patch clone()
old_clone = '''    pub inline fn clone(self: *const Page) !Page {
        const backing = try posix.mmap(
            null,
            self.memory.len,
            posix.PROT.READ | posix.PROT.WRITE,
            .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
            -1,
            0,
        );
        errdefer posix.munmap(backing);
        return self.cloneBuf(backing);
    }'''

new_clone = '''    pub inline fn clone(self: *const Page) !Page {
        if (comptime builtin.target.cpu.arch.isWasm()) {
            const backing = std.heap.wasm_allocator.alignedAlloc(
                u8,
                std.heap.page_size_min,
                self.memory.len,
            ) catch return error.OutOfMemory;
            errdefer std.heap.wasm_allocator.free(backing);
            return self.cloneBuf(backing);
        }
        const backing = try posix.mmap(
            null,
            self.memory.len,
            posix.PROT.READ | posix.PROT.WRITE,
            .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
            -1,
            0,
        );
        errdefer posix.munmap(backing);
        return self.cloneBuf(backing);
    }'''

src = src.replace(old_clone, new_clone, 1)

with open('$PAGE_ZIG', 'w') as f:
    f.write(src)

print('page.zig patched for WASM')
"
