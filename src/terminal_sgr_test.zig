const std = @import("std");
const testing = std.testing;

const cell = @import("cell.zig");
const h = @import("terminal_behavior_helpers.zig");

fn expectStyle(terminal: *const h.Terminal, fg: u16, bg: u16, flags: u8) !void {
    try testing.expectEqual(fg, terminal.current_fg);
    try testing.expectEqual(bg, terminal.current_bg);
    try h.expectFlags(terminal, flags);
}

fn writeByte(terminal: *h.Terminal, byte: u8) void {
    const bytes = [_]u8{byte};
    terminal.write(bytes[0..]);
}

fn writeSgr2(terminal: *h.Terminal, first: u16, second: u16) !void {
    var buf: [24]u8 = undefined;
    const seq = try std.fmt.bufPrint(&buf, "\x1b[{d};{d}m", .{ first, second });
    terminal.write(seq);
}

fn writePalette256(terminal: *h.Terminal, fg: u16, bg: u16) !void {
    var buf: [40]u8 = undefined;
    const seq = try std.fmt.bufPrint(&buf, "\x1b[38;5;{d};48;5;{d}m", .{ fg, bg });
    terminal.write(seq);
}

test "SGR sets basic text attribute flags" {
    var t = h.initTerminal(16, 2);
    defer h.deinitTerminal(&t);

    const cases = [_]struct {
        sgr: []const u8,
        flag: u8,
        glyph: u8,
    }{
        .{ .sgr = "\x1b[1m", .flag = cell.FLAG_BOLD, .glyph = 'B' },
        .{ .sgr = "\x1b[2m", .flag = cell.FLAG_DIM, .glyph = 'D' },
        .{ .sgr = "\x1b[3m", .flag = cell.FLAG_ITALIC, .glyph = 'I' },
        .{ .sgr = "\x1b[4m", .flag = cell.FLAG_UNDERLINE, .glyph = 'U' },
        .{ .sgr = "\x1b[5m", .flag = cell.FLAG_BLINK, .glyph = 'K' },
        .{ .sgr = "\x1b[7m", .flag = cell.FLAG_REVERSE, .glyph = 'R' },
        .{ .sgr = "\x1b[8m", .flag = cell.FLAG_INVISIBLE, .glyph = 'V' },
        .{ .sgr = "\x1b[9m", .flag = cell.FLAG_STRIKETHROUGH, .glyph = 'S' },
    };

    for (cases, 0..) |entry, col| {
        t.write("\x1b[0m");
        t.write(entry.sgr);
        try expectStyle(&t, cell.DEFAULT_COLOR, cell.DEFAULT_COLOR, entry.flag);
        writeByte(&t, entry.glyph);
        try h.expectCell(&t, 0, @intCast(col), @as(u32, entry.glyph), cell.DEFAULT_COLOR, cell.DEFAULT_COLOR, entry.flag);
    }
}

test "SGR reset codes clear matching text attributes" {
    var t = h.initTerminal(8, 2);
    defer h.deinitTerminal(&t);

    const all_flags: u8 = cell.FLAG_BOLD |
        cell.FLAG_DIM |
        cell.FLAG_ITALIC |
        cell.FLAG_UNDERLINE |
        cell.FLAG_BLINK |
        cell.FLAG_REVERSE |
        cell.FLAG_INVISIBLE |
        cell.FLAG_STRIKETHROUGH;

    t.write("\x1b[1;2;3;4;5;7;8;9m");
    try h.expectFlags(&t, all_flags);

    t.write("\x1b[22m");
    try h.expectFlags(&t, all_flags & ~(cell.FLAG_BOLD | cell.FLAG_DIM));
    t.write("\x1b[23m");
    try h.expectFlags(&t, all_flags & ~(cell.FLAG_BOLD | cell.FLAG_DIM | cell.FLAG_ITALIC));
    t.write("\x1b[24m");
    try h.expectFlags(&t, all_flags & ~(cell.FLAG_BOLD | cell.FLAG_DIM | cell.FLAG_ITALIC | cell.FLAG_UNDERLINE));
    t.write("\x1b[25m");
    try h.expectFlags(&t, all_flags & ~(cell.FLAG_BOLD | cell.FLAG_DIM | cell.FLAG_ITALIC | cell.FLAG_UNDERLINE | cell.FLAG_BLINK));
    t.write("\x1b[27m");
    try h.expectFlags(&t, cell.FLAG_INVISIBLE | cell.FLAG_STRIKETHROUGH);
    t.write("\x1b[28m");
    try h.expectFlags(&t, cell.FLAG_STRIKETHROUGH);
    t.write("\x1b[29m");
    try h.expectFlags(&t, 0);
}

test "SGR palette 16 foreground and background colors" {
    var t = h.initTerminal(20, 2);
    defer h.deinitTerminal(&t);

    var i: u16 = 0;
    while (i < 8) : (i += 1) {
        try writeSgr2(&t, 30 + i, 40 + i);
        try expectStyle(&t, i, i, 0);
        writeByte(&t, @intCast('a' + i));
        try h.expectCell(&t, 0, i, @intCast('a' + i), i, i, 0);
    }

    i = 0;
    while (i < 8) : (i += 1) {
        const color = i + 8;
        const col = i + 8;
        try writeSgr2(&t, 90 + i, 100 + i);
        try expectStyle(&t, color, color, 0);
        writeByte(&t, @intCast('A' + i));
        try h.expectCell(&t, 0, col, @intCast('A' + i), color, color, 0);
    }

    t.write("\x1b[39;49m");
    try expectStyle(&t, cell.DEFAULT_COLOR, cell.DEFAULT_COLOR, 0);
}

test "SGR palette 256 foreground and background colors" {
    var t = h.initTerminal(8, 2);
    defer h.deinitTerminal(&t);

    var i: u16 = 0;
    while (i < 256) : (i += 1) {
        try writePalette256(&t, i, i);
        try expectStyle(&t, i, i, 0);
    }

    t.write("\x1b[39;49m");
    try expectStyle(&t, cell.DEFAULT_COLOR, cell.DEFAULT_COLOR, 0);
}

test "SGR zero resets colors and text attributes" {
    var t = h.initTerminal(8, 2);
    defer h.deinitTerminal(&t);

    t.write("\x1b[1;2;3;4;5;7;8;9;31;42m");
    try testing.expect(t.current_fg != cell.DEFAULT_COLOR);
    try testing.expect(t.current_bg != cell.DEFAULT_COLOR);
    try testing.expect(t.current_flags != 0);

    t.write("\x1b[0m");
    try expectStyle(&t, cell.DEFAULT_COLOR, cell.DEFAULT_COLOR, 0);

    t.write("\x1b[1;31;42m");
    t.write("\x1b[m");
    try expectStyle(&t, cell.DEFAULT_COLOR, cell.DEFAULT_COLOR, 0);
}

test "SGR color transitions overwrite current color indexes" {
    var t = h.initTerminal(8, 2);
    defer h.deinitTerminal(&t);

    t.write("\x1b[37;47m");
    try expectStyle(&t, 7, 7, 0);
    t.write("\x1b[38;5;255;48;5;255m");
    try expectStyle(&t, 255, 255, 0);

    t.write("\x1b[38;5;255;48;5;255m");
    try expectStyle(&t, 255, 255, 0);
    t.write("\x1b[37;47m");
    try expectStyle(&t, 7, 7, 0);

    t.write("\x1b[38;2;1;2;3;48;2;4;5;6m");
    t.write("\x1b[38;5;255;48;5;255m");
    try expectStyle(&t, 255, 255, 0);

    t.write("\x1b[38;2;1;2;3;48;2;4;5;6m");
    t.write("\x1b[37;47m");
    try expectStyle(&t, 7, 7, 0);
}

test "SGR colon notation palette 256 colors" {
    var t = h.initTerminal(8, 2);
    defer h.deinitTerminal(&t);

    t.write("\x1b[38:5:50;48:5:200m");
    try expectStyle(&t, 50, 200, 0);

    t.write("\x1b[38;5:51;48;5:201m");
    try expectStyle(&t, 51, 201, 0);
}
