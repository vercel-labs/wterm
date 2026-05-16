const std = @import("std");

/// Return the terminal display width for a single Unicode codepoint.
///
/// This intentionally handles single-codepoint width only. Grapheme clusters
/// that combine multiple codepoints still require a fuller Unicode renderer.
pub fn displayWidth(codepoint: u21) u8 {
    if (isWide(codepoint)) return 2;
    return 1;
}

fn inRange(codepoint: u21, start: u21, end: u21) bool {
    return codepoint >= start and codepoint <= end;
}

pub fn isWide(codepoint: u21) bool {
    return inRange(codepoint, 0x1100, 0x115F) or
        codepoint == 0x2329 or
        codepoint == 0x232A or
        inRange(codepoint, 0x2E80, 0x303E) or
        inRange(codepoint, 0x3040, 0xA4CF) or
        inRange(codepoint, 0xAC00, 0xD7A3) or
        inRange(codepoint, 0xF900, 0xFAFF) or
        inRange(codepoint, 0xFE10, 0xFE19) or
        inRange(codepoint, 0xFE30, 0xFE6F) or
        inRange(codepoint, 0xFF00, 0xFF60) or
        inRange(codepoint, 0xFFE0, 0xFFE6) or
        inRange(codepoint, 0x1F000, 0x1FAFF) or
        inRange(codepoint, 0x20000, 0x3FFFD);
}

test "Unicode width classifies narrow and wide codepoints" {
    try std.testing.expectEqual(@as(u8, 1), displayWidth('A'));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x4E2D));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0xFF21));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x1F4C1));
}
