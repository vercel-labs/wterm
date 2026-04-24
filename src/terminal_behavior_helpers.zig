const std = @import("std");

const cell_mod = @import("cell.zig");
const grid_mod = @import("grid.zig");
const terminal_mod = @import("terminal.zig");

pub const Cell = cell_mod.Cell;
pub const Terminal = terminal_mod.Terminal;

pub fn initTerminal(cols: u16, rows: u16) Terminal {
    var terminal = Terminal.init(cols, rows);
    const alt_grid = std.testing.allocator.create(grid_mod.Grid) catch @panic("failed to allocate alt grid");
    alt_grid.* = grid_mod.Grid.init(cols, rows);
    terminal.alt_grid = alt_grid;
    return terminal;
}

pub fn deinitTerminal(terminal: *Terminal) void {
    if (terminal.alt_grid) |alt_grid| {
        std.testing.allocator.destroy(alt_grid);
        terminal.alt_grid = null;
    }
}

pub fn expectCursor(terminal: *const Terminal, col: u16, row: u16) !void {
    try std.testing.expectEqual(row, terminal.cursor_row);
    try std.testing.expectEqual(col, terminal.cursor_col);
}

pub fn expectLine(terminal: *const Terminal, row: u16, expected_text: []const u8) !void {
    try std.testing.expect(row < terminal.rows);
    try std.testing.expect(expected_text.len <= terminal.cols);

    var actual: [grid_mod.MAX_COLS]u8 = undefined;
    var len: usize = 0;
    var col: u16 = 0;
    while (col < expected_text.len) : (col += 1) {
        actual[len] = @intCast(terminal.grid.getCell(row, col).char);
        len += 1;
    }

    try std.testing.expectEqualStrings(expected_text, actual[0..len]);

    while (col < terminal.cols) : (col += 1) {
        try std.testing.expectEqual(@as(u32, ' '), terminal.grid.getCell(row, col).char);
    }
}

pub fn expectLineTrimmed(terminal: *const Terminal, row: u16, expected_text: []const u8) !void {
    try std.testing.expect(row < terminal.rows);

    var actual: [grid_mod.MAX_COLS * 4]u8 = undefined;
    var len: usize = 0;
    var col: u16 = 0;
    while (col < terminal.cols) : (col += 1) {
        const codepoint: u21 = @intCast(terminal.grid.getCell(row, col).char);
        len += try std.unicode.utf8Encode(codepoint, actual[len..]);
    }

    while (len > 0 and actual[len - 1] == ' ') {
        len -= 1;
    }

    try std.testing.expectEqualStrings(expected_text, actual[0..len]);
}

pub fn expectLinesTrimmed(terminal: *const Terminal, expected_lines: []const []const u8) !void {
    try std.testing.expect(expected_lines.len <= terminal.rows);

    for (expected_lines, 0..) |expected_line, row| {
        try expectLineTrimmed(terminal, @intCast(row), expected_line);
    }
}

pub fn expectCell(
    terminal: *const Terminal,
    row: u16,
    col: u16,
    char: u32,
    fg: u16,
    bg: u16,
    flags: u8,
) !void {
    const cell = terminal.grid.getCell(row, col);
    try std.testing.expectEqual(char, cell.char);
    try std.testing.expectEqual(fg, cell.fg);
    try std.testing.expectEqual(bg, cell.bg);
    try std.testing.expectEqual(flags, cell.flags);
}

pub fn expectFlags(terminal: *const Terminal, expected_flags: u8) !void {
    try std.testing.expectEqual(expected_flags, terminal.current_flags);
}

pub fn expectTitle(terminal: *const Terminal, expected_title: []const u8) !void {
    try std.testing.expectEqualStrings(expected_title, terminal.title_buf[0..terminal.title_len]);
    try std.testing.expect(terminal.title_changed);
}

pub fn setCursor(terminal: *Terminal, col: isize, row: isize) void {
    terminal.cursor_col = clampIndex(col, terminal.cols);
    terminal.cursor_row = clampIndex(row, terminal.rows);
    terminal.wrap_pending = false;
}

fn clampIndex(value: isize, limit: u16) u16 {
    if (value <= 0) return 0;
    const unsigned: usize = @intCast(value);
    if (unsigned >= limit) return limit - 1;
    return @intCast(unsigned);
}
