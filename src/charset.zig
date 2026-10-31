/// Character-set designations apply to printable ASCII, leaving UTF-8 intact.
pub const Charset = enum {
    ascii,
    british,
    dec_special,

    pub fn fromDesignator(byte: u8) ?Charset {
        return switch (byte) {
            'B' => .ascii,
            'A' => .british,
            '0' => .dec_special,
            else => null,
        };
    }

    fn map(self: Charset, codepoint: u21) u21 {
        return switch (self) {
            .ascii => codepoint,
            .british => if (codepoint == '#') '£' else codepoint,
            .dec_special => if (codepoint >= 0x60 and codepoint <= 0x7e)
                dec_special[codepoint - 0x60]
            else
                codepoint,
        };
    }
};

pub const State = struct {
    slots: [4]Charset = [_]Charset{.ascii} ** 4,
    gl: u2 = 0,
    single_shift: ?u2 = null,

    pub fn map(self: *State, codepoint: u21) u21 {
        const slot = self.single_shift orelse self.gl;
        self.single_shift = null;
        return self.slots[slot].map(codepoint);
    }
};

// DEC Special Graphics, positions 0x60–0x7e in the 94-character set.
const dec_special = [_]u21{
    '◆',
    '▒',
    '␉',
    '␌',
    '␍',
    '␊',
    '°',
    '±',
    '␤',
    '␋',
    '┘',
    '┐',
    '┌',
    '└',
    '┼',
    '⎺',
    '⎻',
    '─',
    '⎼',
    '⎽',
    '├',
    '┤',
    '┴',
    '┬',
    '│',
    '≤',
    '≥',
    'π',
    '≠',
    '£',
    '·',
};
