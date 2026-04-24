const h = @import("terminal_behavior_helpers.zig");

fn writeLine(t: *h.Terminal, row: isize, text: []const u8) void {
    h.setCursor(t, 0, row);
    t.write(text);
}

fn fillTenColumnRows(t: *h.Terminal) void {
    writeLine(t, 0, "0123456789");
    writeLine(t, 1, "abcdefghij");
    writeLine(t, 2, "ABCDEFGHIJ");
}

fn fillSixColumnDisplay(t: *h.Terminal) void {
    writeLine(t, 0, "abcdef");
    writeLine(t, 1, "ghijkl");
    writeLine(t, 2, "mnopqr");
    writeLine(t, 3, "stuvwx");
}

test "ICH default inserts one blank" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 5, 0);
    t.write("\x1b[@");
    try h.expectLine(&t, 0, "abcde fghi");
    try h.expectCursor(&t, 5, 0);
}

test "ICH zero parameter inserts one blank" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 5, 0);
    t.write("\x1b[0@");
    try h.expectLine(&t, 0, "abcde fghi");
    try h.expectCursor(&t, 5, 0);
}

test "ICH count shifts cells and truncates right edge" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 4, 0);
    t.write("\x1b[2@");
    try h.expectLine(&t, 0, "abcd  efgh");
    try h.expectCursor(&t, 4, 0);
}

test "ICH count past right edge blanks to end" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 6, 0);
    t.write("\x1b[10@");
    try h.expectLine(&t, 0, "abcdef    ");
    try h.expectCursor(&t, 6, 0);
}

test "ICH affects only cursor row" {
    var t = h.initTerminal(10, 3);
    defer h.deinitTerminal(&t);

    fillTenColumnRows(&t);
    h.setCursor(&t, 3, 1);
    t.write("\x1b[2@");
    try h.expectLine(&t, 0, "0123456789");
    try h.expectLine(&t, 1, "abc  defgh");
    try h.expectLine(&t, 2, "ABCDEFGHIJ");
    try h.expectCursor(&t, 3, 1);
}

test "DCH default deletes one char" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 5, 0);
    t.write("\x1b[P");
    try h.expectLine(&t, 0, "abcdeghij ");
    try h.expectCursor(&t, 5, 0);
}

test "DCH zero parameter deletes one char" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 5, 0);
    t.write("\x1b[0P");
    try h.expectLine(&t, 0, "abcdeghij ");
    try h.expectCursor(&t, 5, 0);
}

test "DCH count shifts left and pads right edge" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 4, 0);
    t.write("\x1b[2P");
    try h.expectLine(&t, 0, "abcdghij  ");
    try h.expectCursor(&t, 4, 0);
}

test "DCH count past right edge blanks to end" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 6, 0);
    t.write("\x1b[10P");
    try h.expectLine(&t, 0, "abcdef    ");
    try h.expectCursor(&t, 6, 0);
}

test "DCH affects only cursor row" {
    var t = h.initTerminal(10, 3);
    defer h.deinitTerminal(&t);

    fillTenColumnRows(&t);
    h.setCursor(&t, 3, 1);
    t.write("\x1b[2P");
    try h.expectLine(&t, 0, "0123456789");
    try h.expectLine(&t, 1, "abcfghij  ");
    try h.expectLine(&t, 2, "ABCDEFGHIJ");
    try h.expectCursor(&t, 3, 1);
}

test "EL default erases cursor through end" {
    var t = h.initTerminal(10, 3);
    defer h.deinitTerminal(&t);

    fillTenColumnRows(&t);
    h.setCursor(&t, 4, 1);
    t.write("\x1b[K");
    try h.expectLine(&t, 0, "0123456789");
    try h.expectLine(&t, 1, "abcd      ");
    try h.expectLine(&t, 2, "ABCDEFGHIJ");
    try h.expectCursor(&t, 4, 1);
}

test "EL mode 0 erases cursor through end" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("0123456789");
    h.setCursor(&t, 4, 0);
    t.write("\x1b[0K");
    try h.expectLine(&t, 0, "0123      ");
    try h.expectCursor(&t, 4, 0);
}

test "EL mode 1 erases start through cursor" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("0123456789");
    h.setCursor(&t, 4, 0);
    t.write("\x1b[1K");
    try h.expectLine(&t, 0, "     56789");
    try h.expectCursor(&t, 4, 0);
}

test "EL mode 2 erases whole line" {
    var t = h.initTerminal(10, 3);
    defer h.deinitTerminal(&t);

    fillTenColumnRows(&t);
    h.setCursor(&t, 4, 1);
    t.write("\x1b[2K");
    try h.expectLine(&t, 0, "0123456789");
    try h.expectLine(&t, 1, "          ");
    try h.expectLine(&t, 2, "ABCDEFGHIJ");
    try h.expectCursor(&t, 4, 1);
}

test "ED default erases cursor through display" {
    var t = h.initTerminal(6, 4);
    defer h.deinitTerminal(&t);

    fillSixColumnDisplay(&t);
    h.setCursor(&t, 3, 1);
    t.write("\x1b[J");
    try h.expectLine(&t, 0, "abcdef");
    try h.expectLine(&t, 1, "ghi   ");
    try h.expectLine(&t, 2, "      ");
    try h.expectLine(&t, 3, "      ");
    try h.expectCursor(&t, 3, 1);
}

test "ED mode 0 erases cursor through display" {
    var t = h.initTerminal(6, 4);
    defer h.deinitTerminal(&t);

    fillSixColumnDisplay(&t);
    h.setCursor(&t, 2, 2);
    t.write("\x1b[0J");
    try h.expectLine(&t, 0, "abcdef");
    try h.expectLine(&t, 1, "ghijkl");
    try h.expectLine(&t, 2, "mn    ");
    try h.expectLine(&t, 3, "      ");
    try h.expectCursor(&t, 2, 2);
}

test "ED mode 1 erases display start through cursor" {
    var t = h.initTerminal(6, 4);
    defer h.deinitTerminal(&t);

    fillSixColumnDisplay(&t);
    h.setCursor(&t, 2, 2);
    t.write("\x1b[1J");
    try h.expectLine(&t, 0, "      ");
    try h.expectLine(&t, 1, "      ");
    try h.expectLine(&t, 2, "   pqr");
    try h.expectLine(&t, 3, "stuvwx");
    try h.expectCursor(&t, 2, 2);
}

test "ED mode 2 erases whole display" {
    var t = h.initTerminal(6, 4);
    defer h.deinitTerminal(&t);

    fillSixColumnDisplay(&t);
    h.setCursor(&t, 2, 2);
    t.write("\x1b[2J");
    try h.expectLine(&t, 0, "      ");
    try h.expectLine(&t, 1, "      ");
    try h.expectLine(&t, 2, "      ");
    try h.expectLine(&t, 3, "      ");
    try h.expectCursor(&t, 2, 2);
}

test "ECH default erases one char without shifting" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 5, 0);
    t.write("\x1b[X");
    try h.expectLine(&t, 0, "abcde ghij");
    try h.expectCursor(&t, 5, 0);
}

test "ECH zero parameter erases one char" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 5, 0);
    t.write("\x1b[0X");
    try h.expectLine(&t, 0, "abcde ghij");
    try h.expectCursor(&t, 5, 0);
}

test "ECH count erases range without shifting" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 4, 0);
    t.write("\x1b[3X");
    try h.expectLine(&t, 0, "abcd   hij");
    try h.expectCursor(&t, 4, 0);
}

test "ECH count past right edge blanks to end" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("abcdefghij");
    h.setCursor(&t, 6, 0);
    t.write("\x1b[10X");
    try h.expectLine(&t, 0, "abcdef    ");
    try h.expectCursor(&t, 6, 0);
}

test "ECH affects only cursor row" {
    var t = h.initTerminal(10, 3);
    defer h.deinitTerminal(&t);

    fillTenColumnRows(&t);
    h.setCursor(&t, 3, 1);
    t.write("\x1b[2X");
    try h.expectLine(&t, 0, "0123456789");
    try h.expectLine(&t, 1, "abc  fghij");
    try h.expectLine(&t, 2, "ABCDEFGHIJ");
    try h.expectCursor(&t, 3, 1);
}

test "DCH after filled row deletes final cell" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("0123456789\x1b[P");
    try h.expectLine(&t, 0, "012345678 ");
    try h.expectCursor(&t, 9, 0);
}

test "ECH after filled row erases final cell" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("0123456789\x1b[X");
    try h.expectLine(&t, 0, "012345678 ");
    try h.expectCursor(&t, 9, 0);
}

test "ICH after filled row inserts blank at final cell" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("0123456789\x1b[@");
    try h.expectLine(&t, 0, "012345678 ");
    try h.expectCursor(&t, 9, 0);
}

test "DCH large count after filled row clamps to final cell" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("0123456789\x1b[10P");
    try h.expectLine(&t, 0, "012345678 ");
    try h.expectCursor(&t, 9, 0);
}

test "ECH large count after filled row clamps to final cell" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("0123456789\x1b[10X");
    try h.expectLine(&t, 0, "012345678 ");
    try h.expectCursor(&t, 9, 0);
}

test "ICH large count after filled row clamps to final cell" {
    var t = h.initTerminal(10, 1);
    defer h.deinitTerminal(&t);

    t.write("0123456789\x1b[10@");
    try h.expectLine(&t, 0, "012345678 ");
    try h.expectCursor(&t, 9, 0);
}
