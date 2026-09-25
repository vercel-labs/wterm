const cell_mod = @import("cell.zig");
const grid_mod = @import("grid.zig");
const Cell = cell_mod.Cell;

pub const MAX_SCROLLBACK_LINES: u32 = 1000;

pub const ScrollbackLine = struct {
    cells: []Cell = undefined,
    capacity: u16 = 0,
    len: u16 = 0,
};

pub const Scrollback = struct {
    lines: [MAX_SCROLLBACK_LINES]ScrollbackLine = [_]ScrollbackLine{.{}} ** MAX_SCROLLBACK_LINES,
    count: u32 = 0,
    write_pos: u32 = 0,
    discarded: u32 = 0,

    /// Free retained rows when a terminal session is reset.
    pub fn reset(self: *Scrollback) void {
        for (&self.lines) |*line| {
            if (line.capacity != 0) grid_mod.allocator.free(line.cells);
            line.* = .{};
        }
        self.count = 0;
        self.write_pos = 0;
        self.discarded = 0;
    }

    pub fn push(self: *Scrollback, row: []const Cell, len: u16) void {
        var line = &self.lines[self.write_pos];
        if (line.capacity < len) {
            const cells = grid_mod.allocator.alloc(Cell, len) catch return;
            if (line.capacity != 0) grid_mod.allocator.free(line.cells);
            line.cells = cells;
            line.capacity = len;
        }
        @memcpy(line.cells[0..len], row[0..len]);
        line.len = len;

        self.write_pos = (self.write_pos + 1) % MAX_SCROLLBACK_LINES;
        if (self.count < MAX_SCROLLBACK_LINES) {
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
        self.write_pos = (self.write_pos + MAX_SCROLLBACK_LINES - 1) % MAX_SCROLLBACK_LINES;
        self.count -= 1;
        return &self.lines[self.write_pos];
    }

    pub fn getLine(self: *const Scrollback, offset: u32) ?*const ScrollbackLine {
        if (offset >= self.count) return null;
        // Counting back from the write position is correct whether or not the
        // ring has wrapped. The previous fast path keyed off `count` being
        // below the maximum, which stopped meaning "never wrapped" once `pop`
        // could lower `count` on a wrapped ring.
        const idx = (self.write_pos + MAX_SCROLLBACK_LINES - 1 - offset) % MAX_SCROLLBACK_LINES;
        return &self.lines[idx];
    }
};
