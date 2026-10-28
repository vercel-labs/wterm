const cell_mod = @import("cell.zig");
const grid_mod = @import("grid.zig");
const Cell = cell_mod.Cell;

/// Lines kept when the host does not set a limit.
pub const DEFAULT_SCROLLBACK_LINES: u32 = 1000;
/// Slots allocated for the first lines; the ring doubles toward its limit.
const INITIAL_SLOTS: u32 = 64;

pub const ScrollbackLine = struct {
    cells: []Cell = undefined,
    capacity: u16 = 0,
    len: u16 = 0,

    fn free(self: *ScrollbackLine) void {
        if (self.capacity != 0) grid_mod.allocator.free(self.cells);
        self.* = .{};
    }
};

pub const Scrollback = struct {
    /// Ring slots. Until the ring holds `limit` slots it has not wrapped: lines
    /// fill `lines[0..count]` and `write_pos == count`.
    lines: []ScrollbackLine = &.{},
    limit: u32 = DEFAULT_SCROLLBACK_LINES,
    count: u32 = 0,
    write_pos: u32 = 0,
    discarded: u32 = 0,
    /// Times the history was cleared; lets a mirror tell a clear from growth.
    clears: u32 = 0,

    /// Free retained rows when a terminal session is reset.
    pub fn reset(self: *Scrollback) void {
        for (self.lines) |*line| line.free();
        self.count = 0;
        self.write_pos = 0;
        self.discarded = 0;
        self.clears +%= 1;
    }

    /// Change how many lines are kept, keeping the newest ones. Returns false,
    /// leaving the history unchanged, when the new ring cannot be allocated.
    pub fn setLimit(self: *Scrollback, limit: u32) bool {
        if (limit == self.limit) return true;
        const kept = @min(self.count, limit);
        const capacity = if (limit == 0) 0 else @max(kept, @min(limit, INITIAL_SLOTS));
        if (!self.moveTo(capacity, kept)) return false;
        self.limit = limit;
        return true;
    }

    /// Replace the ring with `capacity` slots holding the newest `kept` lines,
    /// oldest first, and free every other line.
    fn moveTo(self: *Scrollback, capacity: u32, kept: u32) bool {
        const lines = grid_mod.allocator.alloc(ScrollbackLine, capacity) catch return false;
        var i: u32 = 0;
        while (i < kept) : (i += 1) lines[i] = self.lines[self.slot(kept - 1 - i)];
        for (lines[kept..]) |*line| line.* = .{};
        var dropped = kept;
        while (dropped < self.count) : (dropped += 1) {
            self.lines[self.slot(dropped)].free();
            self.discarded +%= 1;
        }
        // Slots past `count` may still hold buffers from popped lines.
        var unused = self.count;
        while (unused < self.lines.len) : (unused += 1) self.lines[self.slot(unused)].free();
        if (self.lines.len != 0) grid_mod.allocator.free(self.lines);
        self.lines = lines;
        self.count = kept;
        self.write_pos = if (kept == capacity and capacity != 0) 0 else kept;
        return true;
    }

    /// Ring index of the line `offset` steps back from the newest.
    fn slot(self: *const Scrollback, offset: u32) u32 {
        const len: u32 = @intCast(self.lines.len);
        return (self.write_pos + len - 1 - offset % len) % len;
    }

    pub fn push(self: *Scrollback, row: []const Cell, len: u16) void {
        if (self.limit == 0) {
            self.discarded +%= 1;
            return;
        }
        if (self.write_pos == self.lines.len) {
            // Not wrapped yet and out of slots: grow toward the limit.
            const capacity = @min(self.limit, @max(INITIAL_SLOTS, self.count *| 2));
            if (!self.moveTo(capacity, self.count)) return;
        }
        var line = &self.lines[self.write_pos];
        if (line.capacity < len) {
            const cells = grid_mod.allocator.alloc(Cell, len) catch return;
            if (line.capacity != 0) grid_mod.allocator.free(line.cells);
            line.cells = cells;
            line.capacity = len;
        }
        @memcpy(line.cells[0..len], row[0..len]);
        line.len = len;

        self.write_pos += 1;
        if (self.write_pos == self.limit) self.write_pos = 0;
        if (self.count < self.limit) {
            self.count += 1;
        } else {
            self.discarded +%= 1;
        }
    }

    /// Remove and return the most recent line, the one `getLine(0)` returns.
    /// A vertical grow pulls rows back out of history into the viewport, so the
    /// store is no longer append-only: offsets shift and any host holding one
    /// must re-read after a resize.
    pub fn pop(self: *Scrollback) ?*const ScrollbackLine {
        if (self.count == 0) return null;
        const len: u32 = @intCast(self.lines.len);
        self.write_pos = (self.write_pos + len - 1) % len;
        self.count -= 1;
        return &self.lines[self.write_pos];
    }

    pub fn getLine(self: *const Scrollback, offset: u32) ?*const ScrollbackLine {
        if (offset >= self.count) return null;
        // Counting back from the write position is correct whether or not the
        // ring has wrapped. The previous fast path keyed off `count` being
        // below the maximum, which stopped meaning "never wrapped" once `pop`
        // could lower `count` on a wrapped ring.
        return &self.lines[self.slot(offset)];
    }
};

const testing = @import("std").testing;

fn pushChar(sb: *Scrollback, char: u32) void {
    const row = [_]Cell{Cell{ .char = char }};
    sb.push(&row, 1);
}

test "a lower limit keeps the newest lines in order" {
    var sb: Scrollback = .{};
    defer _ = sb.setLimit(0);
    var i: u32 = 0;
    while (i < 10) : (i += 1) pushChar(&sb, 'a' + i);
    try testing.expect(sb.setLimit(4));
    try testing.expectEqual(@as(u32, 4), sb.count);
    try testing.expectEqual(@as(u32, 6), sb.discarded);
    for (0..4) |offset|
        try testing.expectEqual(@as(u32, 'j') - @as(u32, @intCast(offset)), sb.getLine(@intCast(offset)).?.cells[0].char);
    pushChar(&sb, 'k');
    try testing.expectEqual(@as(u32, 'k'), sb.getLine(0).?.cells[0].char);
    try testing.expectEqual(@as(u32, 'h'), sb.getLine(3).?.cells[0].char);
}

test "a higher limit keeps a wrapped history and grows past it" {
    var sb: Scrollback = .{ .limit = 3 };
    defer _ = sb.setLimit(0);
    var i: u32 = 0;
    while (i < 5) : (i += 1) pushChar(&sb, 'a' + i);
    try testing.expect(sb.setLimit(6));
    try testing.expectEqual(@as(u32, 3), sb.count);
    while (i < 8) : (i += 1) pushChar(&sb, 'a' + i);
    try testing.expectEqual(@as(u32, 6), sb.count);
    for (0..6) |offset|
        try testing.expectEqual(@as(u32, 'h') - @as(u32, @intCast(offset)), sb.getLine(@intCast(offset)).?.cells[0].char);
}

test "a zero limit keeps no history" {
    var sb: Scrollback = .{ .limit = 0 };
    pushChar(&sb, 'a');
    try testing.expectEqual(@as(u32, 0), sb.count);
    try testing.expectEqual(@as(u32, 1), sb.discarded);
    try testing.expect(sb.getLine(0) == null);
    try testing.expect(sb.pop() == null);
}

test "the ring grows toward its limit and wraps at it" {
    var sb: Scrollback = .{ .limit = 150 };
    defer _ = sb.setLimit(0);
    var i: u32 = 0;
    while (i < 200) : (i += 1) pushChar(&sb, i);
    try testing.expectEqual(@as(usize, 150), sb.lines.len);
    try testing.expectEqual(@as(u32, 150), sb.count);
    try testing.expectEqual(@as(u32, 50), sb.discarded);
    for (0..150) |offset|
        try testing.expectEqual(@as(u32, 199) - @as(u32, @intCast(offset)), sb.getLine(@intCast(offset)).?.cells[0].char);
    _ = sb.pop();
    try testing.expectEqual(@as(u32, 198), sb.getLine(0).?.cells[0].char);
}
