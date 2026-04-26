const std = @import("std");

const cell = @import("cell.zig");
const h = @import("terminal_behavior_helpers.zig");

const testing = std.testing;

test "DECSET 47 restores main screen and keeps alternate cursor state" {
    var t = h.initTerminal(10, 4);
    defer h.deinitTerminal(&t);

    t.write("MAIN");
    h.setCursor(&t, 2, 1);
    t.write("\x1b[?47hALT");
    try testing.expect(t.using_alt_screen);
    try h.expectLineTrimmed(&t, 0, "");
    try h.expectLineTrimmed(&t, 1, "  ALT");

    t.write("\x1b[?47lZ");
    try testing.expect(!t.using_alt_screen);
    try h.expectLineTrimmed(&t, 0, "MAIN");
    try h.expectLineTrimmed(&t, 1, "     Z");
    try h.expectCursor(&t, 6, 1);
}

test "DECSET 1047 restores main screen and keeps alternate cursor state" {
    var t = h.initTerminal(10, 4);
    defer h.deinitTerminal(&t);

    t.write("MAIN");
    h.setCursor(&t, 2, 1);
    t.write("\x1b[?1047hALT");
    try testing.expect(t.using_alt_screen);
    try h.expectLineTrimmed(&t, 0, "");
    try h.expectLineTrimmed(&t, 1, "  ALT");

    t.write("\x1b[?1047lZ");
    try testing.expect(!t.using_alt_screen);
    try h.expectLineTrimmed(&t, 0, "MAIN");
    try h.expectLineTrimmed(&t, 1, "     Z");
    try h.expectCursor(&t, 6, 1);
}

test "DECSET 1048 saves and restores cursor without switching screen" {
    var t = h.initTerminal(10, 4);
    defer h.deinitTerminal(&t);

    t.write("\x1b[?1048h\r\n\x1b[31mJUNK\x1b[?1048lTEST");

    try testing.expect(!t.using_alt_screen);
    try h.expectLineTrimmed(&t, 0, "TEST");
    try h.expectLineTrimmed(&t, 1, "JUNK");
    try h.expectCell(&t, 0, 0, 'T', cell.DEFAULT_COLOR, cell.DEFAULT_COLOR, 0);
    try h.expectCell(&t, 1, 0, 'J', 1, cell.DEFAULT_COLOR, 0);
    try h.expectCursor(&t, 4, 0);
}

test "DECSET 1049 restores main screen cursor and attributes" {
    var t = h.initTerminal(10, 4);
    defer h.deinitTerminal(&t);

    t.write("MAIN");
    t.write("\x1b[32m");
    h.setCursor(&t, 2, 1);
    t.write("\x1b[?1049h\x1b[31mALT\x1b[?1049lZ");

    try testing.expect(!t.using_alt_screen);
    try h.expectLineTrimmed(&t, 0, "MAIN");
    try h.expectLineTrimmed(&t, 1, "  Z");
    try h.expectCell(&t, 1, 2, 'Z', 2, cell.DEFAULT_COLOR, 0);
    try h.expectCursor(&t, 3, 1);
}

test "DECSET 1049 preserves saved cursor from alternate screen" {
    var t = h.initTerminal(10, 4);
    defer h.deinitTerminal(&t);

    t.write("\x1b[?1049h\r\n\x1b[31m\x1b[s\x1b[?1049lTEST");
    try h.expectLineTrimmed(&t, 0, "TEST");
    try h.expectCell(&t, 0, 0, 'T', cell.DEFAULT_COLOR, cell.DEFAULT_COLOR, 0);

    t.write("\x1b[?1049h\x1b[uTEST");
    try testing.expect(t.using_alt_screen);
    try h.expectLineTrimmed(&t, 1, "TEST");
    try h.expectCell(&t, 1, 0, 'T', 1, cell.DEFAULT_COLOR, 0);
}

test "DECSET 1049 clears alternate screen with erase background" {
    var t = h.initTerminal(10, 4);
    defer h.deinitTerminal(&t);

    t.write("\x1b[42m\x1b[?1049h");

    try testing.expect(t.using_alt_screen);
    try h.expectCell(&t, 2, 5, ' ', cell.DEFAULT_COLOR, 2, 0);
}

test "DECSET modes 2004 7 6 25 toggle terminal flags" {
    var t = h.initTerminal(6, 4);
    defer h.deinitTerminal(&t);

    try testing.expect(!t.bracketed_paste);
    t.write("\x1b[?2004h");
    try testing.expect(t.bracketed_paste);
    t.write("\x1b[?2004l");
    try testing.expect(!t.bracketed_paste);

    try testing.expect(t.auto_wrap);
    t.write("\x1b[?7l123456");
    try testing.expect(!t.auto_wrap);
    try h.expectLineTrimmed(&t, 0, "123456");
    try h.expectCursor(&t, 5, 0);
    t.write("7");
    try h.expectLineTrimmed(&t, 0, "123457");
    try h.expectCursor(&t, 5, 0);
    t.write("\x1b[?7h");
    try testing.expect(t.auto_wrap);

    try testing.expect(!t.origin_mode);
    t.write("\x1b[?6h");
    try testing.expect(t.origin_mode);
    t.write("\x1b[?6l");
    try testing.expect(!t.origin_mode);

    try testing.expect(t.cursor_visible);
    t.write("\x1b[?25l");
    try testing.expect(!t.cursor_visible);
    t.write("\x1b[?25h");
    try testing.expect(t.cursor_visible);
}

test "ESC 7 and ESC 8 restore cursor and attributes" {
    var t = h.initTerminal(10, 4);
    defer h.deinitTerminal(&t);

    t.write("\x1b[31m");
    h.setCursor(&t, 3, 2);
    t.write("\x1b7");
    t.write("\x1b[32m");
    h.setCursor(&t, 8, 3);
    t.write("\x1b8X");

    try h.expectCell(&t, 2, 3, 'X', 1, cell.DEFAULT_COLOR, 0);
    try h.expectCursor(&t, 4, 2);
}

test "DECSTR resets visibility scroll region attributes and modes" {
    var t = h.initTerminal(10, 5);
    defer h.deinitTerminal(&t);

    t.write("\x1b[?25l\x1b[2;4r\x1b[1;32;43m\x1b[?6h\x1b[?7l\x1b[?2004h");
    try testing.expect(!t.cursor_visible);
    try testing.expectEqual(@as(u16, 1), t.scroll_top);
    try testing.expectEqual(@as(u16, 4), t.scroll_bottom);
    try testing.expectEqual(@as(u16, 2), t.current_fg);
    try testing.expectEqual(@as(u16, 3), t.current_bg);
    try h.expectFlags(&t, cell.FLAG_BOLD);
    try testing.expect(t.origin_mode);
    try testing.expect(!t.auto_wrap);
    try testing.expect(t.bracketed_paste);

    t.write("\x1b[!p");

    try testing.expect(t.cursor_visible);
    try testing.expectEqual(@as(u16, 0), t.scroll_top);
    try testing.expectEqual(t.rows, t.scroll_bottom);
    try testing.expectEqual(cell.DEFAULT_COLOR, t.current_fg);
    try testing.expectEqual(cell.DEFAULT_COLOR, t.current_bg);
    try h.expectFlags(&t, 0);
    try testing.expect(!t.origin_mode);
    try testing.expect(t.auto_wrap);
    try testing.expect(!t.bracketed_paste);
}

test "DECSTR resets saved cursor restore target" {
    var t = h.initTerminal(10, 5);
    defer h.deinitTerminal(&t);

    h.setCursor(&t, 4, 3);
    t.write("\x1b[31m\x1b7");
    h.setCursor(&t, 0, 0);
    t.write("\x1b[32m\x1b[!p\x1b8X");

    try h.expectCell(&t, 0, 0, 'X', cell.DEFAULT_COLOR, cell.DEFAULT_COLOR, 0);
    try h.expectCursor(&t, 1, 0);
}

test "OSC 0 and OSC 2 set title" {
    var t = h.initTerminal(10, 4);
    defer h.deinitTerminal(&t);

    t.write("\x1b]0;main title\x07");
    try h.expectTitle(&t, "main title");

    t.title_changed = false;
    t.write("\x1b]2;window title\x1b\\");
    try h.expectTitle(&t, "window title");
}
