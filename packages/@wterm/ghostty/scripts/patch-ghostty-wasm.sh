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
TERMINAL_ZIG="$GHOSTTY_SRC/src/terminal/Terminal.zig"
IMAGE_ZIG="$GHOSTTY_SRC/src/terminal/kitty/graphics_image.zig"
STORAGE_ZIG="$GHOSTTY_SRC/src/terminal/kitty/graphics_storage.zig"

if [[ ! -f "$PAGE_ZIG" ]]; then
  echo "Error: $PAGE_ZIG not found"
  exit 1
fi

[[ -f "$PAGE_ZIG.orig" ]] || cp "$PAGE_ZIG" "$PAGE_ZIG.orig"
[[ -f "$PAGELIST_ZIG.orig" ]] || cp "$PAGELIST_ZIG" "$PAGELIST_ZIG.orig"
[[ -f "$TERMINAL_ZIG.orig" ]] || cp "$TERMINAL_ZIG" "$TERMINAL_ZIG.orig"
[[ -f "$IMAGE_ZIG.orig" ]] || cp "$IMAGE_ZIG" "$IMAGE_ZIG.orig"
[[ -f "$STORAGE_ZIG.orig" ]] || cp "$STORAGE_ZIG" "$STORAGE_ZIG.orig"

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

if 'wasm_allocator' not in src[src.find('inline fn pageAllocator()'):src.find('inline fn pageAllocator()') + 700]:
    src = src.replace(old_pa, new_pa, 1)

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

if 'self.discarded_rows += first.data.size.rows' not in src:
    src = src.replace(
        'self.total_rows -= first.data.size.rows;\\n',
        'self.total_rows -= first.data.size.rows;\\n'
        '        self.discarded_rows += first.data.size.rows;\\n',
        1,
    )

if 'self.discarded_rows -= first.data.size.rows' not in src:
    src = src.replace(
        '            self.total_rows += first.data.size.rows;\\n'
        '            break :prune;',
        '            self.total_rows += first.data.size.rows;\\n'
        '            self.discarded_rows -= first.data.size.rows;\\n'
        '            break :prune;',
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
    'self.discarded_rows += first.data.size.rows',
    'self.discarded_rows -= first.data.size.rows',
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
# Patch Terminal.Options — the image limit belongs to Screen.Options in
# Ghostty 1.3.1, but Terminal owns creation of both screen instances.
# ---------------------------------------------------------------
python3 -c "
with open('$TERMINAL_ZIG') as f: src = f.read()
needle = '''    max_scrollback: usize = 10_000,\n    colors: Colors = .default,'''
replacement = '''    max_scrollback: usize = 10_000,\n    /// Total decoded Kitty image bytes per screen. Zero disables graphics.\n    kitty_image_storage_limit: usize = 320 * 1000 * 1000,\n    colors: Colors = .default,'''
if 'kitty_image_storage_limit: usize = 320 * 1000 * 1000' not in src:
    if needle not in src: raise SystemExit('Terminal.Options shape changed')
    src = src.replace(needle, replacement, 1)
old = '''        .max_scrollback = opts.max_scrollback,\n    });'''
new = '''        .max_scrollback = opts.max_scrollback,\n        .kitty_image_storage_limit = opts.kitty_image_storage_limit,\n    });'''
if '.kitty_image_storage_limit = opts.kitty_image_storage_limit' not in src:
    if old not in src: raise SystemExit('Terminal screen initialization shape changed')
    src = src.replace(old, new, 1)
with open('$TERMINAL_ZIG', 'w') as f: f.write(src)
"

# ---------------------------------------------------------------
# Patch Kitty image storage with an eviction counter. The counter is exposed
# as a diagnostic only; image ownership and eviction policy remain upstream.
# ---------------------------------------------------------------
python3 -c "
with open('$STORAGE_ZIG') as f: src = f.read()
if 'evicted_count: usize = 0' not in src:
    needle = '    total_limit: usize = 320 * 1000 * 1000, // 320MB\\n'
    if needle not in src: raise SystemExit('Kitty storage limit shape changed')
    src = src.replace(needle, needle + '    evicted_count: usize = 0,\\n', 1)
needle = '''                evicted += entry.value_ptr.data.len;
                self.total_bytes -= entry.value_ptr.data.len;

                entry.value_ptr.deinit(alloc);'''
replacement = '''                evicted += entry.value_ptr.data.len;
                self.total_bytes -= entry.value_ptr.data.len;
                self.evicted_count += 1;

                entry.value_ptr.deinit(alloc);'''
if 'self.evicted_count += 1;' not in src:
    if needle not in src: raise SystemExit('Kitty eviction shape changed')
    src = src.replace(needle, replacement, 1)
with open('$STORAGE_ZIG', 'w') as f: f.write(src)
"

# ---------------------------------------------------------------
# Patch Kitty's WASM-incompatible clock and cap decoder allocations. The
# timestamp is only used for deterministic eviction ordering, so a monotonic
# process-local counter is sufficient and avoids importing POSIX timespec.
# ---------------------------------------------------------------
python3 -c "
with open('$IMAGE_ZIG') as f: src = f.read()
if 'const max_size = 32 * 1024 * 1024' not in src:
    old = 'const max_size = 400 * 1024 * 1024; // 400MB'
    if old not in src: raise SystemExit('Kitty image size constant changed')
    src = src.replace(old, 'const max_size = 32 * 1024 * 1024; // bounded WASM image input', 1)
marker_direct = '''        if (t.medium == .direct) {
            try result.addData(alloc, cmd.data);
            return result;
        }
'''
if 'if (comptime builtin.target.cpu.arch.isWasm()) return error.UnsupportedMedium;' not in src:
    if marker_direct not in src: raise SystemExit('Kitty image medium dispatch shape changed')
    src = src.replace(marker_direct, marker_direct + '\n        if (comptime builtin.target.cpu.arch.isWasm()) return error.UnsupportedMedium;\n', 1)
if 'var next_transmit_time: u64 = 1;' not in src:
    marker = 'const log = std.log.scoped(.kitty_gfx);'
    if marker not in src: raise SystemExit('Kitty image log marker changed')
    src = src.replace(marker, marker + '\n\nvar next_transmit_time: u64 = 1;', 1)
src = src.replace('self.image.transmit_time = std.time.Instant.now() catch |err| {\n            log.warn(\"failed to get time: {}\", .{err});\n            return error.InternalError;\n        };', 'self.image.transmit_time = next_transmit_time;\n        next_transmit_time +%= 1;', 1)
if 'transmit_time: std.time.Instant = undefined' in src:
    src = src.replace('transmit_time: std.time.Instant = undefined', 'transmit_time: u64 = 0', 1)
with open('$IMAGE_ZIG', 'w') as f: f.write(src)
"

python3 -c "
with open('$STORAGE_ZIG') as f: src = f.read()
src = src.replace('time: std.time.Instant,', 'time: u64,', 1)
src = src.replace('kv.value_ptr.transmit_time.order(newest.?.transmit_time) == .gt', 'kv.value_ptr.transmit_time > newest.?.transmit_time', 1)
old = '''if (lhs.used == rhs.used) if (lhs.time != rhs.time) return lhs.time < rhs.time;\n                    return lhs.id < rhs.id;\n\n                    // If not used, then its a better candidate\n                    return !lhs.used;'''
new = '''if (lhs.used == rhs.used) {\n                        if (lhs.time != rhs.time) return lhs.time < rhs.time;\n                        return lhs.id < rhs.id;\n                    }\n\n                    // If not used, then its a better candidate\n                    return !lhs.used;'''
if old in src: src = src.replace(old, new, 1)
with open('$STORAGE_ZIG', 'w') as f: f.write(src)
"

echo "Applying pinned Ghostty WASM compatibility patches"

# ---------------------------------------------------------------
# Patch page.zig — mmap/munmap
# ---------------------------------------------------------------
python3 -c "
import sys

with open('$PAGE_ZIG', 'r') as f:
    src = f.read()

# 1. Make posix conditional — void on WASM so no symbols are resolved
if 'if (builtin.target.cpu.arch.isWasm()) void else std.posix' not in src:
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

if 'wasm_page_alloc' not in src:
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

if 'std.heap.wasm_allocator.free(self.memory)' not in src:
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

if 'errdefer std.heap.wasm_allocator.free(backing)' not in src:
    src = src.replace(old_clone, new_clone, 1)

with open('$PAGE_ZIG', 'w') as f:
    f.write(src)

print('page.zig patched for WASM')
"
