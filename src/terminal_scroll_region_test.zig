const std = @import("std");
const h = @import("terminal_behavior_helpers.zig");

fn expectScrollRegion(terminal: *const h.Terminal, top: u16, bottom: u16) !void {
    try std.testing.expectEqual(top, terminal.scroll_top);
    try std.testing.expectEqual(bottom, terminal.scroll_bottom);
}

fn expectLines(terminal: *const h.Terminal, expected: []const []const u8) !void {
    var row: usize = 0;
    while (row < expected.len) : (row += 1) {
        try h.expectLine(terminal, @intCast(row), expected[row]);
    }
}

fn writeNumberedRows(terminal: *h.Terminal) void {
    terminal.write("0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7\r\n8\r\n9");
}

test "DECSTBM defaults and clamps scroll margins" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[r");
    try expectScrollRegion(&t, 0, 10);

    t.write("\x1b[3;7r");
    try expectScrollRegion(&t, 2, 7);

    t.write("\x1b[0;0r");
    try expectScrollRegion(&t, 0, 10);

    t.write("\x1b[3;1000r");
    try expectScrollRegion(&t, 2, 10);
}

test "DECSTBM ignores inverted margins and homes cursor" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    h.setCursor(&t, 9, 9);
    t.write("\x1b[2;7r");
    try expectScrollRegion(&t, 1, 7);
    try h.expectCursor(&t, 0, 0);

    t.write("\x1b[7;2r");
    try expectScrollRegion(&t, 1, 7);
}

test "scrollUp stays within scroll margins" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    writeNumberedRows(&t);
    t.write("\x1b[2;4r\x1b[2Sm");

    try expectLines(&t, &[_][]const u8{
        "m", "3", "", "", "4", "5", "6", "7", "8", "9",
    });
}

test "scrollDown stays within scroll margins" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    writeNumberedRows(&t);
    t.write("\x1b[2;4r\x1b[2Tm");

    try expectLines(&t, &[_][]const u8{
        "m", "", "", "1", "4", "5", "6", "7", "8", "9",
    });
}

test "insertLines outside scroll margins does not scroll" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    writeNumberedRows(&t);
    t.write("\x1b[3;6r");
    try expectScrollRegion(&t, 2, 6);

    t.write("\x1b[2Lm");
    try expectLines(&t, &[_][]const u8{
        "m", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    });

    t.write("\x1b[2H\x1b[2Ln");
    try expectLines(&t, &[_][]const u8{
        "m", "n", "2", "3", "4", "5", "6", "7", "8", "9",
    });

    t.write("\x1b[7H\x1b[2Lo");
    try expectLines(&t, &[_][]const u8{
        "m", "n", "2", "3", "4", "5", "o", "7", "8", "9",
    });

    t.write("\x1b[8H\x1b[2Lp");
    try expectLines(&t, &[_][]const u8{
        "m", "n", "2", "3", "4", "5", "o", "p", "8", "9",
    });

    t.write("\x1b[100H\x1b[2Lq");
    try expectLines(&t, &[_][]const u8{
        "m", "n", "2", "3", "4", "5", "o", "p", "8", "q",
    });
}

test "insertLines inside scroll margins scrolls bounded region" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    writeNumberedRows(&t);
    t.write("\x1b[3;6r");
    try expectScrollRegion(&t, 2, 6);

    t.write("\x1b[3H\x1b[2Lm");
    try expectLines(&t, &[_][]const u8{
        "0", "1", "m", "", "2", "3", "6", "7", "8", "9",
    });

    t.write("\x1b[6H\x1b[2Ln");
    try expectLines(&t, &[_][]const u8{
        "0", "1", "m", "", "2", "n", "6", "7", "8", "9",
    });
}

test "deleteLines outside scroll margins does not scroll" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    writeNumberedRows(&t);
    t.write("\x1b[3;6r");
    try expectScrollRegion(&t, 2, 6);

    t.write("\x1b[2Mm");
    try expectLines(&t, &[_][]const u8{
        "m", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    });

    t.write("\x1b[2H\x1b[2Mn");
    try expectLines(&t, &[_][]const u8{
        "m", "n", "2", "3", "4", "5", "6", "7", "8", "9",
    });

    t.write("\x1b[7H\x1b[2Mo");
    try expectLines(&t, &[_][]const u8{
        "m", "n", "2", "3", "4", "5", "o", "7", "8", "9",
    });

    t.write("\x1b[8H\x1b[2Mp");
    try expectLines(&t, &[_][]const u8{
        "m", "n", "2", "3", "4", "5", "o", "p", "8", "9",
    });

    t.write("\x1b[100H\x1b[2Mq");
    try expectLines(&t, &[_][]const u8{
        "m", "n", "2", "3", "4", "5", "o", "p", "8", "q",
    });
}

test "deleteLines inside scroll margins scrolls bounded region" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    writeNumberedRows(&t);
    t.write("\x1b[3;6r");
    try expectScrollRegion(&t, 2, 6);

    t.write("\x1b[6H\x1b[2Mm");
    try expectLines(&t, &[_][]const u8{
        "0", "1", "2", "3", "4", "m", "6", "7", "8", "9",
    });

    t.write("\x1b[3H\x1b[2Mn");
    try expectLines(&t, &[_][]const u8{
        "0", "1", "n", "m", "", "", "6", "7", "8", "9",
    });
}
