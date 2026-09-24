const cell_mod = @import("cell.zig");
const Cell = cell_mod.Cell;

pub const MAX_COLS: u16 = 256;
pub const MAX_ROWS: u16 = 256;

/// Wide cells and their continuations stay paired within each visible row.
/// Column edits blank split pairs without changing the requested shift.
pub const Grid = struct {
    cells: [MAX_ROWS][MAX_COLS]Cell = undefined,
    cols: u16,
    rows: u16,
    dirty: [MAX_ROWS]u8 = [_]u8{1} ** MAX_ROWS,

    pub fn init(cols: u16, rows: u16) Grid {
        var g = Grid{ .cols = cols, .rows = rows };
        g.clear();
        return g;
    }

    /// Reset an existing grid in-place (no large stack temporaries).
    pub fn reset(self: *Grid, cols: u16, rows: u16) void {
        self.cols = cols;
        self.rows = rows;
        self.clear();
    }

    pub fn getCell(self: *const Grid, row: u16, col: u16) Cell {
        if (row >= self.rows or col >= self.cols) return Cell{};
        return self.cells[row][col];
    }

    pub fn setCell(self: *Grid, row: u16, col: u16, cell: Cell) void {
        if (row >= self.rows or col >= self.cols) return;
        self.cells[row][col] = cell;
        self.dirty[row] = 1;
    }

    pub fn clear(self: *Grid) void {
        var r: u16 = 0;
        while (r < self.rows) : (r += 1) {
            self.clearRow(r);
        }
    }

    pub fn clearRow(self: *Grid, row: u16) void {
        self.clearRowAs(row, Cell{});
    }

    pub fn clearRowAs(self: *Grid, row: u16, blank: Cell) void {
        if (row >= self.rows) return;
        var c: u16 = 0;
        while (c < self.cols) : (c += 1) {
            self.cells[row][c] = blank;
        }
        self.dirty[row] = 1;
    }

    pub fn clearRange(self: *Grid, row: u16, start_col: u16, end_col: u16) void {
        self.clearRangeAs(row, start_col, end_col, Cell{});
    }

    pub fn clearRangeAs(self: *Grid, row: u16, start_col: u16, end_col: u16, blank: Cell) void {
        if (row >= self.rows) return;
        var start = if (start_col > self.cols) self.cols else start_col;
        var end = if (end_col > self.cols) self.cols else end_col;

        if (start < end) {
            if (start < self.cols and self.cells[row][start].width == cell_mod.WIDTH_CONTINUATION and start > 0) {
                start -= 1;
            }
            if (end < self.cols and self.cells[row][end].width == cell_mod.WIDTH_CONTINUATION) {
                end += 1;
            } else if (end > 0 and end < self.cols and self.cells[row][end - 1].width == cell_mod.WIDTH_WIDE) {
                end += 1;
            }
        }

        var c = start;
        while (c < end) : (c += 1) {
            self.cells[row][c] = blank;
        }
        self.dirty[row] = 1;
    }

    pub fn clearWideCellAt(self: *Grid, row: u16, col: u16, blank: Cell) void {
        if (row >= self.rows or col >= self.cols) return;
        const cell = self.cells[row][col];
        if (cell.width == cell_mod.WIDTH_CONTINUATION) {
            if (col > 0 and self.cells[row][col - 1].width == cell_mod.WIDTH_WIDE) {
                self.cells[row][col - 1] = blank;
            }
            self.cells[row][col] = blank;
            self.dirty[row] = 1;
            return;
        }
        if (cell.width == cell_mod.WIDTH_WIDE) {
            self.cells[row][col] = blank;
            if (col + 1 < self.cols and self.cells[row][col + 1].width == cell_mod.WIDTH_CONTINUATION) {
                self.cells[row][col + 1] = blank;
            }
            self.dirty[row] = 1;
        }
    }

    /// Repair a row so no wide cell lacks its continuation and no continuation
    /// lacks its wide cell, considering only the first `width` columns.
    ///
    /// The width argument matters when a row is about to be stored at a
    /// narrower width than the grid it came from: a pair straddling that
    /// boundary must be blanked before the prefix is copied, or the copy keeps
    /// a wide cell whose continuation was left behind.
    pub fn sanitizeWideRowWidth(self: *Grid, row: u16, width: u16, blank: Cell) void {
        var c: u16 = 0;
        var changed = false;
        while (c < width) {
            const cell = self.cells[row][c];
            if (cell.width == cell_mod.WIDTH_CONTINUATION) {
                if (c == 0 or self.cells[row][c - 1].width != cell_mod.WIDTH_WIDE) {
                    self.cells[row][c] = blank;
                    changed = true;
                }
                c += 1;
            } else if (cell.width == cell_mod.WIDTH_WIDE) {
                if (c + 1 >= width or self.cells[row][c + 1].width != cell_mod.WIDTH_CONTINUATION) {
                    self.cells[row][c] = blank;
                    changed = true;
                    c += 1;
                } else {
                    c += 2;
                }
            } else {
                if (cell.width != cell_mod.WIDTH_NARROW) {
                    self.cells[row][c].width = cell_mod.WIDTH_NARROW;
                    changed = true;
                }
                c += 1;
            }
        }
        if (changed) self.dirty[row] = 1;
    }

    /// Delete exactly `count` columns, blanking any wide pair split by the
    /// deletion before shifting. Repairing only after the shift could join
    /// halves of two different wide characters into a seemingly valid pair.
    pub fn deleteCells(self: *Grid, row: u16, start: u16, count: u16, blank: Cell) void {
        if (row >= self.rows or start >= self.cols or count == 0) return;
        const n = @min(count, self.cols - start);
        self.clearRangeAs(row, start, start + n, blank);
        var col = start;
        while (col + n < self.cols) : (col += 1) {
            self.cells[row][col] = self.cells[row][col + n];
        }
        while (col < self.cols) : (col += 1) {
            self.cells[row][col] = blank;
        }
    }

    /// Insert exactly `count` columns at `start`, clearing wide pairs split
    /// by the insertion point or the right edge without moving either boundary.
    pub fn insertCells(self: *Grid, row: u16, start: u16, count: u16, blank: Cell) void {
        if (row >= self.rows or start >= self.cols or count == 0) return;
        const n = @min(count, self.cols - start);
        if (self.cells[row][start].width == cell_mod.WIDTH_CONTINUATION) {
            self.clearWideCellAt(row, start, blank);
        }
        self.clearRangeAs(row, self.cols - n, self.cols, blank);
        var col = self.cols;
        while (col > start + n) {
            col -= 1;
            self.cells[row][col] = self.cells[row][col - n];
        }
        col = start;
        while (col < start + n) : (col += 1) {
            self.cells[row][col] = blank;
        }
    }

    pub fn scrollUp(self: *Grid, top: u16, bottom: u16, count: u16, blank: Cell) void {
        if (count == 0 or top >= bottom) return;
        const n = if (count > bottom - top) bottom - top else count;

        var row = top;
        while (row + n < bottom) : (row += 1) {
            self.cells[row] = self.cells[row + n];
            self.dirty[row] = 1;
        }
        while (row < bottom) : (row += 1) {
            self.clearRowAs(row, blank);
        }
    }

    pub fn scrollDown(self: *Grid, top: u16, bottom: u16, count: u16, blank: Cell) void {
        if (count == 0 or top >= bottom) return;
        const n = if (count > bottom - top) bottom - top else count;
        const span = bottom - top - n;

        var i: u16 = 0;
        while (i < span) : (i += 1) {
            const dst = bottom - 1 - i;
            const src = dst - n;
            self.cells[dst] = self.cells[src];
            self.dirty[dst] = 1;
        }
        var row = top;
        while (row < top + n) : (row += 1) {
            self.clearRowAs(row, blank);
        }
    }

    pub fn clearDirty(self: *Grid) void {
        var r: u16 = 0;
        while (r < self.rows) : (r += 1) {
            self.dirty[r] = 0;
        }
    }
};
