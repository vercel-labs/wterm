const std = @import("std");
const table = @import("grapheme_break_table.zig");

pub const Gcb = enum(u4) {
    other,
    cr,
    lf,
    control,
    extend,
    zwj,
    regional_indicator,
    prepend,
    spacing_mark,
    l,
    v,
    t,
    lv,
    lvt,
};

pub const InCb = enum(u2) { none, consonant, extend, linker };

pub const Props = struct {
    gcb: Gcb,
    ext_pict: bool,
    incb: InCb,
};

pub fn props(cp: u21) Props {
    var low: usize = 0;
    var high: usize = table.runs.len;
    while (high - low > 1) {
        const mid = low + (high - low) / 2;
        if (table.runs[mid] >> 8 <= cp) low = mid else high = mid;
    }
    const p: u8 = @truncate(table.runs[low]);
    return .{
        .gcb = @enumFromInt(p & 0x0f),
        .ext_pict = p & 0x10 != 0,
        .incb = @enumFromInt(p >> 5),
    };
}

/// Extended grapheme cluster segmentation (UAX #29), fed one code point at a time.
pub const Segmenter = struct {
    prev: ?Props = null,
    /// Regional indicators in the current run, for GB12 and GB13.
    ri_count: u32 = 0,
    /// GB11: inside ExtPict Extend*, and whether a ZWJ just followed it.
    pict_run: bool = false,
    pict_zwj: bool = false,
    /// GB9c: a consonant followed by Extend/Linker, and whether a Linker was seen.
    conjunct: bool = false,
    conjunct_linker: bool = false,

    /// Returns true when a cluster boundary falls before `cp`.
    pub fn breaksBefore(self: *Segmenter, cp: u21) bool {
        const cur = props(cp);
        const result = if (self.prev) |prev| self.rule(prev, cur) else true;
        self.advance(cur);
        return result;
    }

    fn rule(self: *const Segmenter, prev: Props, cur: Props) bool {
        const a = prev.gcb;
        const b = cur.gcb;
        if (a == .cr and b == .lf) return false; // GB3
        if (a == .control or a == .cr or a == .lf) return true; // GB4
        if (b == .control or b == .cr or b == .lf) return true; // GB5
        if (a == .l and (b == .l or b == .v or b == .lv or b == .lvt)) return false; // GB6
        if ((a == .lv or a == .v) and (b == .v or b == .t)) return false; // GB7
        if ((a == .lvt or a == .t) and b == .t) return false; // GB8
        if (b == .extend or b == .zwj) return false; // GB9
        if (b == .spacing_mark) return false; // GB9a
        if (a == .prepend) return false; // GB9b
        if (cur.incb == .consonant and self.conjunct and self.conjunct_linker) return false; // GB9c
        if (cur.ext_pict and self.pict_zwj) return false; // GB11
        if (a == .regional_indicator and b == .regional_indicator and self.ri_count % 2 == 1) return false; // GB12, GB13
        return true; // GB999
    }

    fn advance(self: *Segmenter, cur: Props) void {
        self.ri_count = if (cur.gcb == .regional_indicator) self.ri_count + 1 else 0;

        if (cur.ext_pict) {
            self.pict_run = true;
            self.pict_zwj = false;
        } else if (cur.gcb == .zwj and self.pict_run) {
            self.pict_zwj = true;
            self.pict_run = false;
        } else if (cur.gcb == .extend and self.pict_run) {
            // Extend* keeps the run open.
        } else {
            self.pict_run = false;
            self.pict_zwj = false;
        }

        switch (cur.incb) {
            .consonant => {
                self.conjunct = true;
                self.conjunct_linker = false;
            },
            .linker => if (self.conjunct) {
                self.conjunct_linker = true;
            },
            .extend => {},
            .none => {
                self.conjunct = false;
                self.conjunct_linker = false;
            },
        }
        self.prev = cur;
    }
};

test "GraphemeBreakTest.txt" {
    const data = @import("grapheme_break_test_data.zig");
    for (data.cases, 0..) |case, n| {
        var seg: Segmenter = .{};
        for (case.cps, case.breaks, 0..) |cp, expected, i| {
            const got = seg.breaksBefore(cp);
            if (got != expected) {
                std.debug.print("case {d}, code point {d} (U+{X:0>4}): expected break={}\n", .{ n, i, cp, expected });
                return error.TestUnexpectedResult;
            }
        }
    }
}

/// Set in a cell's `char` when the low bits index `ClusterTable` instead of
/// holding a code point. Code points never use bit 31.
pub const CLUSTER_BIT: u32 = 0x8000_0000;
/// Code points kept per cluster. Later ones still join the cluster but are not
/// stored, so a run of combining marks cannot grow the table without bound.
pub const MAX_CLUSTER_CODEPOINTS: usize = 32;
pub const MAX_CLUSTERS: u32 = 65536;
pub const MAX_CLUSTER_BYTES: u32 = 1 << 20;

/// Interned UTF-8 clusters, deduplicated, alive until the terminal is reset.
pub const ClusterTable = struct {
    bytes: std.ArrayList(u8) = .empty,
    /// offsets[i] .. offsets[i + 1] spans cluster i; one more entry than clusters.
    offsets: std.ArrayList(u32) = .empty,
    by_hash: std.AutoHashMapUnmanaged(u64, u32) = .empty,
    rejected: u32 = 0,

    pub fn deinit(self: *ClusterTable, alloc: std.mem.Allocator) void {
        self.bytes.deinit(alloc);
        self.offsets.deinit(alloc);
        self.by_hash.deinit(alloc);
        self.* = .{};
    }

    /// Forget every cluster, keeping the allocations.
    pub fn reset(self: *ClusterTable) void {
        self.bytes.clearRetainingCapacity();
        self.offsets.clearRetainingCapacity();
        self.by_hash.clearRetainingCapacity();
        self.rejected = 0;
    }

    pub fn count(self: *const ClusterTable) u32 {
        return if (self.offsets.items.len == 0) 0 else @intCast(self.offsets.items.len - 1);
    }

    pub fn get(self: *const ClusterTable, index: u32) ?[]const u8 {
        if (index >= self.count()) return null;
        return self.bytes.items[self.offsets.items[index]..self.offsets.items[index + 1]];
    }

    /// Returns the index of `utf8`, adding it if new, or null when the table is full.
    pub fn intern(self: *ClusterTable, alloc: std.mem.Allocator, utf8: []const u8) ?u32 {
        const hash = std.hash.Wyhash.hash(0, utf8);
        if (self.by_hash.get(hash)) |index| {
            if (std.mem.eql(u8, self.get(index).?, utf8)) return index;
        }
        if (self.count() >= MAX_CLUSTERS or self.bytes.items.len + utf8.len > MAX_CLUSTER_BYTES) {
            self.rejected +|= 1;
            return null;
        }
        if (self.offsets.items.len == 0) self.offsets.append(alloc, 0) catch return null;
        self.bytes.appendSlice(alloc, utf8) catch return null;
        self.offsets.append(alloc, @intCast(self.bytes.items.len)) catch {
            self.bytes.shrinkRetainingCapacity(self.offsets.items[self.offsets.items.len - 1]);
            return null;
        };
        const index = self.count() - 1;
        // A hash collision keeps the older entry reachable by hash; the new one is still valid.
        self.by_hash.put(alloc, hash, index) catch {};
        return index;
    }
};

test "cluster table deduplicates and resolves" {
    const alloc = std.testing.allocator;
    var t: ClusterTable = .{};
    defer t.deinit(alloc);
    const a = t.intern(alloc, "e\u{301}").?;
    const b = t.intern(alloc, "\u{1F1EF}\u{1F1F5}").?;
    try std.testing.expectEqual(a, t.intern(alloc, "e\u{301}").?);
    try std.testing.expect(a != b);
    try std.testing.expectEqualStrings("\u{1F1EF}\u{1F1F5}", t.get(b).?);
    try std.testing.expectEqual(@as(?[]const u8, null), t.get(2));
}
