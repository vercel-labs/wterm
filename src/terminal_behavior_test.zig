const h = @import("terminal_behavior_helpers.zig");

comptime {
    _ = @import("terminal_erase_test.zig");
    _ = @import("terminal_sgr_test.zig");
    _ = @import("terminal_scroll_region_test.zig");
    _ = @import("terminal_modes_reset_osc_test.zig");
}

test "CUF cursor forward" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[C");
    try h.expectCursor(&t, 1, 0);
    t.write("\x1b[1C");
    try h.expectCursor(&t, 2, 0);
    t.write("\x1b[4C");
    try h.expectCursor(&t, 6, 0);
    t.write("\x1b[100C");
    try h.expectCursor(&t, 9, 0);

    h.setCursor(&t, 8, 4);
    t.write("\x1b[C");
    try h.expectCursor(&t, 9, 4);
}

test "CUB cursor backward" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[D");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[1D");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[100C");
    t.write("\x1b[D");
    try h.expectCursor(&t, 8, 0);
    t.write("\x1b[1D");
    try h.expectCursor(&t, 7, 0);
    t.write("\x1b[4D");
    try h.expectCursor(&t, 3, 0);
    t.write("\x1b[100D");
    try h.expectCursor(&t, 0, 0);

    h.setCursor(&t, 4, 4);
    t.write("\x1b[D");
    try h.expectCursor(&t, 3, 4);
}

test "CUD cursor down" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[B");
    try h.expectCursor(&t, 0, 1);
    t.write("\x1b[1B");
    try h.expectCursor(&t, 0, 2);
    t.write("\x1b[4B");
    try h.expectCursor(&t, 0, 6);
    t.write("\x1b[100B");
    try h.expectCursor(&t, 0, 9);

    h.setCursor(&t, 8, 0);
    t.write("\x1b[B");
    try h.expectCursor(&t, 8, 1);
}

test "CUU cursor up" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[A");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[1A");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[100B");
    t.write("\x1b[A");
    try h.expectCursor(&t, 0, 8);
    t.write("\x1b[1A");
    try h.expectCursor(&t, 0, 7);
    t.write("\x1b[4A");
    try h.expectCursor(&t, 0, 3);
    t.write("\x1b[100A");
    try h.expectCursor(&t, 0, 0);

    h.setCursor(&t, 8, 9);
    t.write("\x1b[A");
    try h.expectCursor(&t, 8, 8);
}

test "CNL cursor next line" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[E");
    try h.expectCursor(&t, 0, 1);
    t.write("\x1b[1E");
    try h.expectCursor(&t, 0, 2);
    t.write("\x1b[4E");
    try h.expectCursor(&t, 0, 6);
    t.write("\x1b[100E");
    try h.expectCursor(&t, 0, 9);

    h.setCursor(&t, 8, 0);
    t.write("\x1b[E");
    try h.expectCursor(&t, 0, 1);
}

test "CPL cursor previous line" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[F");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[1F");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[100E");
    t.write("\x1b[F");
    try h.expectCursor(&t, 0, 8);
    t.write("\x1b[1F");
    try h.expectCursor(&t, 0, 7);
    t.write("\x1b[4F");
    try h.expectCursor(&t, 0, 3);
    t.write("\x1b[100F");
    try h.expectCursor(&t, 0, 0);

    h.setCursor(&t, 8, 9);
    t.write("\x1b[F");
    try h.expectCursor(&t, 0, 8);
}

test "CHA cursor character absolute" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[G");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[1G");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[2G");
    try h.expectCursor(&t, 1, 0);
    t.write("\x1b[5G");
    try h.expectCursor(&t, 4, 0);
    t.write("\x1b[100G");
    try h.expectCursor(&t, 9, 0);
}

test "CUP cursor position" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    h.setCursor(&t, 5, 5);
    t.write("\x1b[H");
    try h.expectCursor(&t, 0, 0);
    h.setCursor(&t, 5, 5);
    t.write("\x1b[1H");
    try h.expectCursor(&t, 0, 0);
    h.setCursor(&t, 5, 5);
    t.write("\x1b[1;1H");
    try h.expectCursor(&t, 0, 0);
    h.setCursor(&t, 5, 5);
    t.write("\x1b[8H");
    try h.expectCursor(&t, 0, 7);
    h.setCursor(&t, 5, 5);
    t.write("\x1b[;8H");
    try h.expectCursor(&t, 7, 0);
    h.setCursor(&t, 5, 5);
    t.write("\x1b[100;100H");
    try h.expectCursor(&t, 9, 9);
}

test "HPA horizontal position absolute" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[`");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[1`");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[2`");
    try h.expectCursor(&t, 1, 0);
    t.write("\x1b[5`");
    try h.expectCursor(&t, 4, 0);
    t.write("\x1b[100`");
    try h.expectCursor(&t, 9, 0);
}

test "HPR horizontal position relative" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[a");
    try h.expectCursor(&t, 1, 0);
    t.write("\x1b[1a");
    try h.expectCursor(&t, 2, 0);
    t.write("\x1b[4a");
    try h.expectCursor(&t, 6, 0);
    t.write("\x1b[100a");
    try h.expectCursor(&t, 9, 0);

    h.setCursor(&t, 8, 4);
    t.write("\x1b[a");
    try h.expectCursor(&t, 9, 4);
}

test "VPA vertical position absolute" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[d");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[1d");
    try h.expectCursor(&t, 0, 0);
    t.write("\x1b[2d");
    try h.expectCursor(&t, 0, 1);
    t.write("\x1b[5d");
    try h.expectCursor(&t, 0, 4);
    t.write("\x1b[100d");
    try h.expectCursor(&t, 0, 9);

    h.setCursor(&t, 8, 4);
    t.write("\x1b[d");
    try h.expectCursor(&t, 8, 0);
}

test "VPR vertical position relative" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    t.write("\x1b[e");
    try h.expectCursor(&t, 0, 1);
    t.write("\x1b[1e");
    try h.expectCursor(&t, 0, 2);
    t.write("\x1b[4e");
    try h.expectCursor(&t, 0, 6);
    t.write("\x1b[100e");
    try h.expectCursor(&t, 0, 9);

    h.setCursor(&t, 8, 4);
    t.write("\x1b[e");
    try h.expectCursor(&t, 8, 5);
}

test "DCH keeps cursor position at boundaries" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    h.setCursor(&t, 9, 9);
    t.write("\x1b[P");
    try h.expectCursor(&t, 9, 9);
    h.setCursor(&t, 0, 0);
    t.write("\x1b[P");
    try h.expectCursor(&t, 0, 0);
}

test "ECH keeps cursor position at boundaries" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    h.setCursor(&t, 9, 9);
    t.write("\x1b[X");
    try h.expectCursor(&t, 9, 9);
    h.setCursor(&t, 0, 0);
    t.write("\x1b[X");
    try h.expectCursor(&t, 0, 0);
}

test "ICH keeps cursor position at boundaries" {
    var t = h.initTerminal(10, 10);
    defer h.deinitTerminal(&t);

    h.setCursor(&t, 9, 9);
    t.write("\x1b[@");
    try h.expectCursor(&t, 9, 9);
    h.setCursor(&t, 0, 0);
    t.write("\x1b[@");
    try h.expectCursor(&t, 0, 0);
}
