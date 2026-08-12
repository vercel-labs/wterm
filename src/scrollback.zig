const cell_mod = @import("cell.zig");
const grid_mod = @import("grid.zig");
const Cell = cell_mod.Cell;

pub const MAX_SCROLLBACK_LINES: u32 = 1000;

pub const ScrollbackLine = struct {
    cells: [grid_mod.MAX_COLS]Cell = undefined,
    len: u16 = 0,
};

pub const Scrollback = struct {
    lines: [MAX_SCROLLBACK_LINES]ScrollbackLine = undefined,
    count: u32 = 0,
    write_pos: u32 = 0,
    discarded: u32 = 0,

    /// Reset counters without touching the lines array (avoids large stack copies).
    pub fn reset(self: *Scrollback) void {
        self.count = 0;
        self.write_pos = 0;
        self.discarded = 0;
    }

    pub fn push(self: *Scrollback, row: []const Cell, len: u16) void {
        var line = &self.lines[self.write_pos];
        var i: u16 = 0;
        while (i < len) : (i += 1) {
            line.cells[i] = row[i];
        }
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
