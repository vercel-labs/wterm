const std = @import("std");
const table = @import("unicode_width_table.zig");

/// Return the terminal display width for a single Unicode codepoint.
///
/// This intentionally handles single-codepoint width only. Grapheme clusters
/// that combine multiple codepoints still require a fuller Unicode renderer,
/// so combining marks and joiners each report width 1 rather than 0.
pub fn displayWidth(codepoint: u21) u8 {
    if (isWide(codepoint)) return 2;
    return 1;
}

/// True when East_Asian_Width is W or F. The ranges come from the Unicode
/// Character Database via scripts/gen-unicode-width.mjs. Block-sized
/// approximations classify assigned narrow characters as wide.
pub fn isWide(codepoint: u21) bool {
    var low: usize = 0;
    var high: usize = table.wide_ranges.len;
    while (low < high) {
        const mid = low + (high - low) / 2;
        const range = table.wide_ranges[mid];
        if (codepoint < range[0]) {
            high = mid;
        } else if (codepoint > range[1]) {
            low = mid + 1;
        } else {
            return true;
        }
    }
    return false;
}

test "Unicode width classifies narrow and wide codepoints" {
    try std.testing.expectEqual(@as(u8, 1), displayWidth('A'));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x4E2D));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0xFF21));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x1F4C1));
}

test "Unicode width follows East_Asian_Width rather than whole blocks" {
    // Unassigned inside Hiragana. Not in any W/F range and not in a block
    // that defaults to W, so it is narrow.
    try std.testing.expectEqual(@as(u8, 1), displayWidth(0x3040));
    // Assigned neighbours in the same block stay wide.
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x3041));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x303E));

    // Symbol blocks a block-sized range swept up. Unicode calls these narrow.
    try std.testing.expectEqual(@as(u8, 1), displayWidth(0x1F100)); // enclosed alphanumeric
    try std.testing.expectEqual(@as(u8, 1), displayWidth(0x1F030)); // domino tile
    try std.testing.expectEqual(@as(u8, 1), displayWidth(0x1F700)); // alchemical symbol
    try std.testing.expectEqual(@as(u8, 1), displayWidth(0x1F810)); // arrow

    // Unassigned inside a block documented as defaulting to W stays wide.
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x4DBF));

    // Emoji that are genuinely wide.
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x1F600));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x1F926));

    // Boundaries of the first range.
    try std.testing.expectEqual(@as(u8, 1), displayWidth(0x10FF));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x1100));
    try std.testing.expectEqual(@as(u8, 2), displayWidth(0x115F));
    try std.testing.expectEqual(@as(u8, 1), displayWidth(0x1160));
}
