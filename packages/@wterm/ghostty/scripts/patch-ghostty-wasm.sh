#!/bin/bash
# Patches ghostty source for wasm32-freestanding compatibility.
#
# The pinned Ghostty source needs these targeted WASM patches:
#   1. Terminal.zig — forwards the per-screen Kitty image limit
#   2. Screen.zig — preserves the Kitty image limit across RIS
#   3. kitty/graphics_image.zig — bounds direct decoding and removes POSIX time
#   4. kitty/graphics_storage.zig — bounds and compacts image/placement storage
#   5. kitty/graphics_exec.zig — passes the owning screen to image storage
#   6. kitty/graphics_unicode.zig — updates upstream image-storage tests
#   7. page.zig — uses posix.mmap/munmap for page memory
#   8. PageList.zig — pageAllocator() returns Mach VM allocator on macOS
#
# Page memory is replaced with wasm_allocator on WASM targets, Kitty file and
# shared-memory media are disabled, Wuffs gets freestanding compatibility
# declarations, and image metadata is compacted after eviction.
#
# Pinned to ghostty v1.3.1 — verify after version bumps.
set -euo pipefail

GHOSTTY_SRC="$1"
PAGE_ZIG="$GHOSTTY_SRC/src/terminal/page.zig"
PAGELIST_ZIG="$GHOSTTY_SRC/src/terminal/PageList.zig"
TERMINAL_ZIG="$GHOSTTY_SRC/src/terminal/Terminal.zig"
SCREEN_ZIG="$GHOSTTY_SRC/src/terminal/Screen.zig"
IMAGE_ZIG="$GHOSTTY_SRC/src/terminal/kitty/graphics_image.zig"
STORAGE_ZIG="$GHOSTTY_SRC/src/terminal/kitty/graphics_storage.zig"
EXEC_ZIG="$GHOSTTY_SRC/src/terminal/kitty/graphics_exec.zig"
UNICODE_ZIG="$GHOSTTY_SRC/src/terminal/kitty/graphics_unicode.zig"

if [[ ! -f "$PAGE_ZIG" ]]; then
  echo "Error: $PAGE_ZIG not found"
  exit 1
fi

# Keep a pristine copy of every pinned upstream file and always start from it.
# The Zig package cache is shared between builds, so patching the current file
# in place and trying to recognize every transformed shape is fragile: a
# second invocation must produce the same source as the first one. The .orig
# files are deliberately adjacent to the cache entries and are not part of the
# generated WASM artifact.
for source in \
  "$PAGE_ZIG" \
  "$PAGELIST_ZIG" \
  "$TERMINAL_ZIG" \
  "$SCREEN_ZIG" \
  "$IMAGE_ZIG" \
  "$STORAGE_ZIG" \
  "$EXEC_ZIG" \
  "$UNICODE_ZIG"; do
  [[ -f "$source.orig" ]] || cp "$source" "$source.orig"
  cp "$source.orig" "$source"
done

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

# Preserve the configured Kitty image budget when RIS rebuilds the screen's
# image storage. Upstream resets the storage with a default struct literal,
# which otherwise silently changes both a disabled limit and any custom limit
# back to Ghostty's 320 MiB default.
# ---------------------------------------------------------------
python3 -c "
with open('$SCREEN_ZIG') as f: src = f.read()
old = '''    if (comptime build_options.kitty_graphics) {
        // Reset kitty graphics storage
        self.kitty_images.deinit(self.alloc, self);
        self.kitty_images = .{ .dirty = true };
    }'''
new = '''    if (comptime build_options.kitty_graphics) {
        // Reset kitty graphics storage while preserving the configured limit.
        const kitty_image_storage_limit = self.kitty_images.total_limit;
        self.kitty_images.deinit(self.alloc, self);
        self.kitty_images = .{
            .dirty = true,
            .total_limit = kitty_image_storage_limit,
        };
    }'''
if new not in src:
    if old not in src: raise SystemExit('Screen.reset Kitty storage shape changed')
    src = src.replace(old, new, 1)
required = [
    'const kitty_image_storage_limit = self.kitty_images.total_limit;',
    '.total_limit = kitty_image_storage_limit,',
]
missing = [needle for needle in required if needle not in src]
if missing: raise SystemExit(f'Screen reset image limit patch failed: {missing}')
with open('$SCREEN_ZIG', 'w') as f: f.write(src)
"

# Patch Kitty image storage with an eviction counter and bounded metadata.
# The upstream maps use tombstones after removeByPtr. Repeated image IDs can
# therefore grow their backing allocation even while decoded bytes stay under
# the configured limit. Compact the image map after eviction/deletion and
# reject new images and placements once their independent metadata budgets are
# full. The image budget is intentionally separate from decoded bytes: a
# stream of unique tiny images must not be able to grow the image map forever.
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

# Bound metadata independently of decoded pixels. AutoHashMapUnmanaged keeps
# its backing allocation after removeByPtr, so compact both maps whenever an
# eviction or deletion changes their resident sets. Placements are capped and
# reject new entries at capacity; failed placement commands release their pin
# in Ghostty's executor and leave the bounded set intact.
python3 -c "
with open('$STORAGE_ZIG') as f: src = f.read()

if 'const wterm_max_placements: usize = 4096;' not in src:
    marker = 'const log = std.log.scoped(.kitty_gfx);'
    if marker not in src: raise SystemExit('Kitty storage log marker changed')
    src = src.replace(
        marker,
        marker + '\\n\\n/// Bound placement metadata independently of decoded image bytes.\\n'
        'const wterm_max_placements: usize = 4096;',
        1,
    )

if 'const wterm_max_images: usize = 4096;' not in src:
    marker = 'const wterm_max_placements: usize = 4096;'
    if marker not in src: raise SystemExit('Kitty image metadata marker changed')
    src = src.replace(
        marker,
        marker + '\\n\\n/// Bound resident image metadata independently of decoded image bytes.\\n'
        'const wterm_max_images: usize = 4096;',
        1,
    )

image_guard = (
    '        if (self.images.get(img.id) == null and\\n'
    '            self.images.count() >= wterm_max_images)\\n'
    '        {\\n'
    '            // Do not run the allocation-heavy byte eviction scan for\\n'
    '            // every metadata-only overflow. The bounded resident set\\n'
    '            // fails closed until an existing image is explicitly deleted\\n'
    '            // or normal byte-budget eviction creates room.\\n'
    '            return error.OutOfMemory;\\n'
    '        }\\n\\n'
)
if image_guard not in src:
    marker = '        // If this would put us over the limit, then evict.\\n'
    if marker not in src: raise SystemExit('Kitty image insertion shape changed')
    src = src.replace(marker, image_guard + marker, 1)

placement_marker = '        const gop = try self.placements.getOrPut(alloc, key);\\n'
placement_guard = (
    '        if (self.placements.count() >= wterm_max_placements and\\n'
    '            self.placements.get(key) == null)\\n'
    '        {\\n'
    '            return error.OutOfMemory;\\n'
    '        }\\n\\n'
)
if placement_guard not in src:
    if placement_marker not in src: raise SystemExit('Kitty placement insertion shape changed')
    src = src.replace(placement_marker, placement_guard + placement_marker, 1)

compact_helper = (
    '\\n    /// Rebuild the image map with capacity proportional to resident entries.\\n'
    '    /// Image values contain borrowed slices here; their owned pixel data is\\n'
    '    /// intentionally not deinitialized while the map is replaced.\\n'
    '    fn compactImages(self: *ImageStorage, alloc: Allocator) void {\\n'
    '        if (self.images.count() == 0) {\\n'
    '            self.images.clearAndFree(alloc);\\n'
    '            return;\\n'
    '        }\\n'
    '        const compacted = self.images.clone(alloc) catch return;\\n'
    '        self.images.deinit(alloc);\\n'
    '        self.images = compacted;\\n'
    '    }\\n'
)
if 'fn compactImages(self: *ImageStorage' not in src:
    marker = '    pub fn imageById(self: *const ImageStorage, image_id: u32) ?Image {\\n'
    if marker not in src: raise SystemExit('Kitty image lookup shape changed')
    src = src.replace(marker, compact_helper + marker, 1)

placement_compact_helper = (
    '\\n    /// Rebuild placement metadata after removals so tombstones cannot\\n'
    '    /// grow the WASM heap beyond the bounded resident set. Placement\\n'
    '    /// values contain borrowed page-pin pointers, so cloning the map\\n'
    '    /// does not transfer ownership of those pins.\\n'
    '    fn compactPlacements(self: *ImageStorage, alloc: Allocator) void {\\n'
    '        if (self.placements.count() == 0) {\\n'
    '            self.placements.clearAndFree(alloc);\\n'
    '            return;\\n'
    '        }\\n'
    '        const compacted = self.placements.clone(alloc) catch return;\\n'
    '        self.placements.deinit(alloc);\\n'
    '        self.placements = compacted;\\n'
    '    }\\n'
)
if 'fn compactPlacements(self: *ImageStorage' not in src:
    marker = '    pub fn imageById(self: *const ImageStorage, image_id: u32) ?Image {\\n'
    if marker not in src: raise SystemExit('Kitty placement lookup shape changed')
    src = src.replace(marker, placement_compact_helper + marker, 1)

delete_marker = '        }\\n    }\\n\\n    fn deleteById(\\n'
delete_replacement = (
    '        }\\n\\n'
    '        self.compactImages(alloc);\\n'
    '        self.compactPlacements(alloc);\\n'
    '    }\\n\\n'
    '    fn deleteById(\\n'
)
if 'self.compactImages(alloc);\\n        self.compactPlacements(alloc);\\n    }\\n\\n    fn deleteById' not in src:
    if delete_marker not in src: raise SystemExit('Kitty delete function shape changed')
    src = src.replace(delete_marker, delete_replacement, 1)

evict_success = '                if (evicted > req) return true;'
if 'self.compactImages(alloc);\\n                    self.compactPlacements(alloc);\\n                    return true;' not in src:
    if evict_success not in src: raise SystemExit('Kitty eviction completion shape changed')
    src = src.replace(
        evict_success,
        '                if (evicted >= req) {\\n'
        '                    self.compactImages(alloc);\\n'
        '                    self.compactPlacements(alloc);\\n'
        '                    return true;\\n'
        '                }',
        1,
    )

evict_end = '        return false;\\n    }\\n\\n    /// Every placement is uniquely identified'
if 'self.compactImages(alloc);\\n        return false;\\n    }\\n\\n    /// Every placement' not in src:
    if evict_end not in src: raise SystemExit('Kitty eviction return shape changed')
    src = src.replace(
        evict_end,
        '        self.compactImages(alloc);\\n'
        '        self.compactPlacements(alloc);\\n'
        '        return false;\\n    }\\n\\n'
        '    /// Every placement is uniquely identified',
        1,
    )

required = [
    'const wterm_max_placements: usize = 4096;',
    'const wterm_max_images: usize = 4096;',
    image_guard,
    placement_guard,
    'fn compactImages(self: *ImageStorage',
    'fn compactPlacements(self: *ImageStorage',
    'self.compactImages(alloc);',
    'self.compactPlacements(alloc);',
]
missing = [needle for needle in required if needle not in src]
if missing: raise SystemExit(f'Kitty storage bound patch failed: {missing}')

with open('$STORAGE_ZIG', 'w') as f: f.write(src)
"

# Eviction removes placements as well as images. Deinitialize each placement
# first so its tracked page pin is released; otherwise repeated image churn
# grows the page-list metadata and eventually the WASM heap despite bounded
# image and placement counts. The active screen is available at every call
# site, including the upstream storage tests.
python3 -c "
with open('$STORAGE_ZIG') as f: src = f.read()

old_signature = 'fn evictImage(self: *ImageStorage, alloc: Allocator, req: usize) !bool {'
new_signature = 'fn evictImage(self: *ImageStorage, alloc: Allocator, s: *terminal.Screen, req: usize) !bool {'
if old_signature in src:
    src = src.replace(old_signature, new_signature, 1)
elif new_signature not in src:
    raise SystemExit('Kitty eviction signature shape changed')

old_add = 'pub fn addImage(self: *ImageStorage, alloc: Allocator, img: Image) Allocator.Error!void {'
new_add = 'pub fn addImage(self: *ImageStorage, alloc: Allocator, s: *terminal.Screen, img: Image) Allocator.Error!void {'
if old_add in src:
    src = src.replace(old_add, new_add, 1)
elif new_add not in src:
    raise SystemExit('Kitty addImage signature shape changed')

src = src.replace('self.evictImage(alloc, req_bytes)', 'self.evictImage(alloc, s, req_bytes)')

old_remove = '''                if (entry.key_ptr.image_id == c.id) {
                    self.placements.removeByPtr(entry.key_ptr);
                }'''
new_remove = '''                if (entry.key_ptr.image_id == c.id) {
                    entry.value_ptr.deinit(s);
                    self.placements.removeByPtr(entry.key_ptr);
                }'''
if old_remove in src:
    src = src.replace(old_remove, new_remove, 1)
elif new_remove not in src:
    raise SystemExit('Kitty eviction placement cleanup shape changed')

required = [
    new_signature,
    new_add,
    'self.evictImage(alloc, s, req_bytes)',
    'entry.value_ptr.deinit(s);\n                    self.placements.removeByPtr(entry.key_ptr);',
]
missing = [needle for needle in required if needle not in src]
if missing: raise SystemExit(f'Kitty eviction pin cleanup patch failed: {missing}')

with open('$STORAGE_ZIG', 'w') as f: f.write(src)
"

# Match the new storage API at every upstream call site. These are the
# executor and unicode-placement tests; all have the owning Terminal in
# scope, so use its active screen for page-pin cleanup during eviction.
python3 -c "
import re

for path in ('$EXEC_ZIG', '$UNICODE_ZIG', '$STORAGE_ZIG'):
    with open(path) as f: src = f.read()
    src = re.sub(
        r'(?<![A-Za-z0-9_])([a-zA-Z_][A-Za-z0-9_]*)\\.addImage\\(alloc, (?!t\\.screens\\.active,)',
        r'\\1.addImage(alloc, t.screens.active, ',
        src,
    )
    with open(path, 'w') as f: f.write(src)

with open('$EXEC_ZIG') as f: exec_src = f.read()
with open('$UNICODE_ZIG') as f: unicode_src = f.read()
with open('$STORAGE_ZIG') as f: storage_src = f.read()
if 'storage.addImage(alloc, t.screens.active, img);' in exec_src:
    exec_src = exec_src.replace(
        'storage.addImage(alloc, t.screens.active, img);',
        'storage.addImage(alloc, terminal.screens.active, img);',
        1,
    )
    with open('$EXEC_ZIG', 'w') as f: f.write(exec_src)
if 'storage.addImage(alloc, terminal.screens.active, img);' not in exec_src:
    raise SystemExit('Kitty executor addImage call site was not patched')
if 's.addImage(alloc, t.screens.active, image);' not in unicode_src:
    raise SystemExit('Kitty unicode addImage call sites were not patched')
if re.search(r'(?<!pub fn )\\b[a-zA-Z_]\\w*\\.addImage\\(alloc, (?!t\\.screens\\.active,)', storage_src):
    raise SystemExit('Kitty storage test addImage call site was not patched')
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
