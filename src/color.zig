const std = @import("std");
const cell_mod = @import("cell.zig");

/// Cell colors above DEFAULT_COLOR index this table of 24-bit values.
pub const FIRST_INDEX: u16 = cell_mod.DEFAULT_COLOR + 1;
pub const MAX_COLORS: u16 = 4096;
const SLOT_COUNT: u16 = MAX_COLORS * 2;

pub const Table = struct {
    rgb: [MAX_COLORS]u32 = undefined,
    /// Open-addressed lookup from RGB to table position + 1; 0 marks an empty slot.
    slots: [SLOT_COUNT]u16 = [_]u16{0} ** SLOT_COUNT,
    count: u16 = 0,
    rejected: u32 = 0,

    pub fn reset(self: *Table) void {
        @memset(&self.slots, 0);
        self.count = 0;
        self.rejected = 0;
    }

    /// Returns the cell color index for an RGB value, or null once the table is full.
    pub fn intern(self: *Table, rgb: u32) ?u16 {
        var slot: u16 = @intCast((rgb *% 0x9E3779B1) >> 19);
        while (true) : (slot = (slot + 1) & (SLOT_COUNT - 1)) {
            const entry = self.slots[slot];
            if (entry == 0) break;
            if (self.rgb[entry - 1] == rgb) return FIRST_INDEX + entry - 1;
        }
        if (self.count == MAX_COLORS) {
            self.rejected +|= 1;
            return null;
        }
        self.rgb[self.count] = rgb;
        self.count += 1;
        self.slots[slot] = self.count;
        return FIRST_INDEX + self.count - 1;
    }

    pub fn get(self: *const Table, index: u16) ?u32 {
        if (index < FIRST_INDEX or index - FIRST_INDEX >= self.count) return null;
        return self.rgb[index - FIRST_INDEX];
    }
};

test "interning deduplicates and resolves exact values" {
    var t: Table = .{};
    const a = t.intern(0xff6400).?;
    const b = t.intern(0x0a141e).?;
    try std.testing.expectEqual(a, t.intern(0xff6400).?);
    try std.testing.expect(a != b);
    try std.testing.expectEqual(@as(u32, 0xff6400), t.get(a).?);
    try std.testing.expectEqual(@as(u32, 0x0a141e), t.get(b).?);
    try std.testing.expectEqual(@as(?u32, null), t.get(cell_mod.DEFAULT_COLOR));
}

test "full table rejects new values and keeps existing ones" {
    var t: Table = .{};
    var i: u32 = 0;
    while (i < MAX_COLORS) : (i += 1) _ = t.intern(i).?;
    try std.testing.expectEqual(@as(?u16, null), t.intern(0xabcdef));
    try std.testing.expectEqual(@as(u32, 1), t.rejected);
    try std.testing.expectEqual(@as(u32, 7), t.get(t.intern(7).?).?);
}
