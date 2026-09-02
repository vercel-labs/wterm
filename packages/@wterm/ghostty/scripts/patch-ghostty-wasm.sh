#!/bin/bash
# Patches ghostty source for wasm32-freestanding compatibility.
#
# The pinned Ghostty source needs these targeted WASM patches:
#   1. page.zig — uses posix.mmap/munmap for page memory
#   2. PageList.zig — pageAllocator() returns Mach VM allocator on macOS
#
# Page memory is replaced with wasm_allocator on WASM targets using
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
# Patch Kitty's WASM-incompatible clock, cap decoder allocations, and reject
# oversized PNG dimensions before Wuffs can allocate a decoded pixel buffer.
# timestamp is only used for deterministic eviction ordering, so a monotonic
# process-local counter is sufficient and avoids importing POSIX timespec.
# ---------------------------------------------------------------
python3 -c "
import re

with open('$IMAGE_ZIG') as f: src = f.read()
old_size = 'const max_size = 400 * 1024 * 1024; // 400MB'
new_size = 'const max_size = 32 * 1024 * 1024; // bounded WASM image input'
if old_size in src:
    src = src.replace(old_size, new_size, 1)
elif new_size not in src:
    raise SystemExit('Kitty image size constant shape changed')
marker_direct = '''        if (t.medium == .direct) {
            try result.addData(alloc, cmd.data);
            return result;
        }
'''
direct_guard = '        if (comptime builtin.target.cpu.arch.isWasm()) return error.UnsupportedMedium;'
if direct_guard not in src:
    if marker_direct not in src: raise SystemExit('Kitty image medium dispatch shape changed')
    src = src.replace(marker_direct, marker_direct + '\n        if (comptime builtin.target.cpu.arch.isWasm()) return error.UnsupportedMedium;\n', 1)
if 'var next_transmit_time: u64 = 1;' not in src:
    marker = 'const log = std.log.scoped(.kitty_gfx);'
    if marker not in src: raise SystemExit('Kitty image log marker changed')
    src = src.replace(marker, marker + '\n\nvar next_transmit_time: u64 = 1;', 1)
old_clock = '''self.image.transmit_time = std.time.Instant.now() catch |err| {
            log.warn(\"failed to get time: {}\", .{err});
            return error.InternalError;
        };'''
new_clock = '''self.image.transmit_time = next_transmit_time;
        next_transmit_time +%= 1;'''
if old_clock in src:
    src = src.replace(old_clock, new_clock, 1)
elif new_clock not in src:
    raise SystemExit('Kitty image timestamp shape changed')
if 'transmit_time: std.time.Instant = undefined' in src:
    src = src.replace('transmit_time: std.time.Instant = undefined', 'transmit_time: u64 = 0', 1)
elif 'transmit_time: u64 = 0' not in src:
    raise SystemExit('Kitty image timestamp field shape changed')

png_preflight = '''        // Wuffs allocates the decoded output from the dimensions in the
        // PNG header. Validate those dimensions and the RGBA byte count
        // before entering Wuffs so a tiny compressed PNG cannot request a
        // huge allocation and only fail after it has completed.
        if (self.data.items.len < 33 or
            self.data.items[0] != 0x89 or self.data.items[1] != 0x50 or
            self.data.items[2] != 0x4e or self.data.items[3] != 0x47 or
            self.data.items[4] != 0x0d or self.data.items[5] != 0x0a or
            self.data.items[6] != 0x1a or self.data.items[7] != 0x0a or
            std.mem.readInt(u32, self.data.items[8..12], .big) != 13 or
            self.data.items[12] != 'I' or self.data.items[13] != 'H' or
            self.data.items[14] != 'D' or self.data.items[15] != 'R')
        {
            return error.InvalidData;
        }
        const png_width = std.mem.readInt(u32, self.data.items[16..20], .big);
        const png_height = std.mem.readInt(u32, self.data.items[20..24], .big);
        if (png_width == 0 or png_height == 0 or
            png_width > max_dimension or png_height > max_dimension)
        {
            return error.DimensionsTooLarge;
        }
        const png_pixels = std.math.mul(
            usize,
            @as(usize, png_width),
            @as(usize, png_height),
        ) catch return error.InvalidData;
        const png_rgba_size = std.math.mul(usize, png_pixels, 4) catch
            return error.InvalidData;
        if (png_rgba_size > max_size) return error.InvalidData;
'''
png_pattern = re.compile(
    '        // Wuffs allocates the decoded output from the dimensions in the\n'
    '        // PNG header\..*?'
    '        if \(png_rgba_size > max_size\) return error\.InvalidData;\n',
    re.S,
)
if not png_pattern.search(src):
    marker = '        assert(self.image.format == .png);\n'
    if marker not in src: raise SystemExit('Kitty PNG decoder shape changed')
    src = src.replace(marker, marker + '\n' + png_preflight, 1)
else:
    src = png_pattern.sub(png_preflight, src, count=1)

required = [
    new_size,
    direct_guard,
    new_clock,
    'transmit_time: u64 = 0',
    'const png_width = std.mem.readInt(u32, self.data.items[16..20], .big);',
    'const png_height = std.mem.readInt(u32, self.data.items[20..24], .big);',
]
missing = [needle for needle in required if needle not in src]
if missing: raise SystemExit(f'Kitty image patch failed: {missing}')
with open('$IMAGE_ZIG', 'w') as f: f.write(src)
"

python3 -c "
with open('$STORAGE_ZIG') as f: src = f.read()
old_time = 'time: std.time.Instant,'
new_time = 'time: u64,'
if old_time in src:
    src = src.replace(old_time, new_time, 1)
elif new_time not in src:
    raise SystemExit('Kitty storage candidate timestamp shape changed')
old_number = 'kv.value_ptr.transmit_time.order(newest.?.transmit_time) == .gt'
new_number = 'kv.value_ptr.transmit_time > newest.?.transmit_time'
if old_number in src:
    src = src.replace(old_number, new_number, 1)
elif new_number not in src:
    raise SystemExit('Kitty image-number timestamp comparison shape changed')
old_order = '''                    if (lhs.used == rhs.used) return switch (lhs.time.order(rhs.time)) {
                        .lt => true,
                        .gt => false,
                        .eq => lhs.id < rhs.id,
                    };'''
new_order = '''                    if (lhs.used == rhs.used) {
                        if (lhs.time != rhs.time) return lhs.time < rhs.time;
                        return lhs.id < rhs.id;
                    }'''
if old_order in src:
    src = src.replace(old_order, new_order, 1)
elif new_order not in src:
    raise SystemExit('Kitty eviction timestamp sort shape changed')
if '.order(' in src or 'time: std.time.Instant,' in src:
    raise SystemExit('Kitty storage still contains the POSIX timestamp comparison')
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
