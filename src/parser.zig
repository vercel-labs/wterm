pub const MAX_PARAMS: u8 = 16;
pub const MAX_INTERMEDIATES: u8 = 2;
pub const MAX_OSC: u16 = 512;
pub const MAX_APC: u16 = 16384;

pub const Action = enum {
    none,
    print,
    execute,
    csi_dispatch,
    esc_dispatch,
    osc_dispatch,
    unsupported_apc,
};

pub const State = enum {
    ground,
    utf8,
    escape,
    escape_intermediate,
    csi_param,
    csi_intermediate,
    csi_ignore,
    osc_string,
    apc_string,
    apc_escape,
};

pub const Parser = struct {
    state: State = .ground,

    // Data associated with the last action
    print_char: u21 = 0,
    execute_byte: u8 = 0,

    // CSI / ESC collected data
    params: [MAX_PARAMS]u16 = [_]u16{0} ** MAX_PARAMS,
    param_count: u8 = 0,
    params_full: bool = false,
    subparam: [MAX_PARAMS]bool = [_]bool{false} ** MAX_PARAMS,
    intermediates: [MAX_INTERMEDIATES]u8 = [_]u8{0} ** MAX_INTERMEDIATES,
    intermediate_count: u8 = 0,
    csi_private: u8 = 0,

    // OSC collected data
    osc_data: [MAX_OSC]u8 = undefined,
    osc_len: u16 = 0,
    osc_truncated: bool = false,
    /// The OSC ended with BEL rather than ST, so replies end the same way.
    osc_bel: bool = false,
    apc_len: u16 = 0,
    apc_truncated: bool = false,

    // UTF-8 decoder
    utf8_buf: [4]u8 = undefined,
    utf8_len: u3 = 0,
    utf8_need: u3 = 0,
    /// Allowed range for the next continuation byte, from the lead byte.
    utf8_lower: u8 = 0x80,
    utf8_upper: u8 = 0xBF,
    /// Set when an invalid byte ended a sequence: the caller prints one U+FFFD
    /// before handling the action returned for that byte.
    replacement_pending: bool = false,

    pub fn feed(self: *Parser, byte: u8) Action {
        // ESC always starts a new sequence (except in OSC where ST = ESC \ terminates)
        if (byte == 0x1B) {
            // An incomplete sequence left in the air is one maximal subpart.
            if (self.state == .utf8) {
                self.state = .ground;
                self.replacement_pending = true;
            }
            if (self.state == .osc_string) {
                self.state = .escape;
                self.osc_bel = false;
                return .osc_dispatch;
            }
            if (self.state == .apc_string or self.state == .apc_escape) {
                self.state = .apc_escape;
                return .none;
            }
            self.enterEscape();
            return .none;
        }

        // CAN (0x18) and SUB (0x1A) cancel any sequence
        if (byte == 0x18 or byte == 0x1A) {
            if (self.state == .utf8) self.replacement_pending = true;
            self.state = .ground;
            return .none;
        }

        return switch (self.state) {
            .ground => self.handleGround(byte),
            .utf8 => self.handleUtf8(byte),
            .escape => self.handleEscape(byte),
            .escape_intermediate => self.handleEscapeIntermediate(byte),
            .csi_param => self.handleCsiParam(byte),
            .csi_intermediate => self.handleCsiIntermediate(byte),
            .csi_ignore => self.handleCsiIgnore(byte),
            .osc_string => self.handleOscString(byte),
            .apc_string => self.handleApcString(byte),
            .apc_escape => self.handleApcEscape(byte),
        };
    }

    /// Consumes CSI digits and separators, leaving other bytes for feed.
    pub fn feedCsiParams(self: *Parser, data: []const u8) usize {
        var offset: usize = 0;
        while (offset < data.len) {
            const byte = data[offset];
            if (byte >= '0' and byte <= '9') {
                if (self.param_count == 0) self.param_count = 1;
                const index = self.param_count - 1;
                var value = self.params[index];
                while (offset < data.len and data[offset] >= '0' and data[offset] <= '9') : (offset += 1) {
                    value = value *| 10 +| @as(u16, data[offset] - '0');
                }
                if (!self.params_full) self.params[index] = value;
            } else if (byte == ';' or byte == ':') {
                _ = self.handleCsiParam(byte);
                offset += 1;
            } else break;
        }
        return offset;
    }

    fn enterEscape(self: *Parser) void {
        self.state = .escape;
        self.intermediate_count = 0;
        self.csi_private = 0;
    }

    fn enterCsi(self: *Parser) void {
        self.state = .csi_param;
        self.param_count = 0;
        self.params_full = false;
        self.intermediate_count = 0;
        self.csi_private = 0;
        var i: u8 = 0;
        while (i < MAX_PARAMS) : (i += 1) {
            self.params[i] = 0;
            self.subparam[i] = false;
        }
    }

    // -- Ground state --

    fn handleGround(self: *Parser, byte: u8) Action {
        if (byte < 0x20) {
            self.execute_byte = byte;
            return .execute;
        }
        if (byte < 0x7F) {
            self.print_char = byte;
            return .print;
        }
        if (byte == 0x7F) {
            self.execute_byte = 0x7F;
            return .execute;
        }

        // UTF-8 multi-byte sequences. Bytes 0x80..0xC1 and 0xF5..0xFF cannot
        // start a scalar value, so each of them becomes one U+FFFD.
        if (byte >= 0xC2 and byte <= 0xDF) {
            return self.beginUtf8(byte, 2, 0x80, 0xBF);
        }
        if (byte >= 0xE0 and byte <= 0xEF) {
            const lower: u8 = if (byte == 0xE0) 0xA0 else 0x80;
            const upper: u8 = if (byte == 0xED) 0x9F else 0xBF;
            return self.beginUtf8(byte, 3, lower, upper);
        }
        if (byte >= 0xF0 and byte <= 0xF4) {
            const lower: u8 = if (byte == 0xF0) 0x90 else 0x80;
            const upper: u8 = if (byte == 0xF4) 0x8F else 0xBF;
            return self.beginUtf8(byte, 4, lower, upper);
        }

        self.print_char = 0xFFFD;
        return .print;
    }

    fn beginUtf8(self: *Parser, byte: u8, need: u3, lower: u8, upper: u8) Action {
        self.utf8_buf[0] = byte;
        self.utf8_len = 1;
        self.utf8_need = need;
        self.utf8_lower = lower;
        self.utf8_upper = upper;
        self.state = .utf8;
        return .none;
    }

    // -- UTF-8 continuation --

    fn handleUtf8(self: *Parser, byte: u8) Action {
        if (byte < self.utf8_lower or byte > self.utf8_upper) {
            // The bytes collected so far are one maximal invalid subpart. Emit
            // its replacement, then handle this byte as if it began in ground.
            self.state = .ground;
            self.replacement_pending = true;
            return self.handleGround(byte);
        }
        self.utf8_buf[self.utf8_len] = byte;
        self.utf8_len += 1;
        self.utf8_lower = 0x80;
        self.utf8_upper = 0xBF;
        if (self.utf8_len == self.utf8_need) {
            self.print_char = decodeUtf8(self.utf8_buf[0..self.utf8_need]) orelse 0xFFFD;
            self.state = .ground;
            return .print;
        }
        return .none;
    }

    /// True once per invalid byte that ended an incomplete sequence, so the
    /// caller prints its U+FFFD before acting on the byte that ended it.
    pub fn takeReplacement(self: *Parser) bool {
        const pending = self.replacement_pending;
        self.replacement_pending = false;
        return pending;
    }

    // -- Escape state --

    fn handleEscape(self: *Parser, byte: u8) Action {
        if (byte == '[') {
            self.enterCsi();
            return .none;
        }
        if (byte == ']') {
            self.state = .osc_string;
            self.osc_len = 0;
            self.osc_truncated = false;
            return .none;
        }
        if (byte == '_') {
            self.state = .apc_string;
            self.apc_len = 0;
            self.apc_truncated = false;
            return .none;
        }
        if (byte >= 0x20 and byte <= 0x2F) {
            self.collectIntermediate(byte);
            self.state = .escape_intermediate;
            return .none;
        }
        if (byte >= 0x30 and byte <= 0x7E) {
            self.execute_byte = byte;
            self.state = .ground;
            return .esc_dispatch;
        }
        // C0 controls during escape
        if (byte < 0x20) {
            self.execute_byte = byte;
            return .execute;
        }
        self.state = .ground;
        return .none;
    }

    // -- Escape intermediate --

    fn handleEscapeIntermediate(self: *Parser, byte: u8) Action {
        if (byte >= 0x20 and byte <= 0x2F) {
            self.collectIntermediate(byte);
            return .none;
        }
        if (byte >= 0x30 and byte <= 0x7E) {
            self.execute_byte = byte;
            self.state = .ground;
            return .esc_dispatch;
        }
        if (byte < 0x20) {
            self.execute_byte = byte;
            return .execute;
        }
        self.state = .ground;
        return .none;
    }

    // -- CSI param state --

    fn handleCsiParam(self: *Parser, byte: u8) Action {
        if (byte >= '0' and byte <= '9') {
            if (!self.params_full) {
                const idx = if (self.param_count == 0) blk: {
                    self.param_count = 1;
                    break :blk @as(u8, 0);
                } else self.param_count - 1;
                const digit: u16 = byte - '0';
                self.params[idx] = self.params[idx] *| 10 +| digit;
            }
            return .none;
        }
        if (byte == ';' or byte == ':') {
            if (self.param_count < MAX_PARAMS) {
                if (self.param_count == 0) self.param_count = 1;
                const next = self.param_count;
                self.param_count += 1;
                if (self.param_count > MAX_PARAMS) {
                    self.param_count = MAX_PARAMS;
                    self.params_full = true;
                } else if (byte == ':') {
                    self.subparam[next] = true;
                }
            }
            return .none;
        }
        if (byte == '?' or byte == '>' or byte == '<' or byte == '=' or byte == '!') {
            self.csi_private = byte;
            return .none;
        }
        if (byte >= 0x20 and byte <= 0x2F) {
            self.collectIntermediate(byte);
            self.state = .csi_intermediate;
            return .none;
        }
        if (byte >= 0x40 and byte <= 0x7E) {
            self.execute_byte = byte;
            self.state = .ground;
            return .csi_dispatch;
        }
        // C0 controls during CSI
        if (byte < 0x20) {
            self.execute_byte = byte;
            return .execute;
        }
        self.state = .csi_ignore;
        return .none;
    }

    // -- CSI intermediate --

    fn handleCsiIntermediate(self: *Parser, byte: u8) Action {
        if (byte >= 0x20 and byte <= 0x2F) {
            self.collectIntermediate(byte);
            return .none;
        }
        if (byte >= 0x40 and byte <= 0x7E) {
            self.execute_byte = byte;
            self.state = .ground;
            return .csi_dispatch;
        }
        if (byte < 0x20) {
            self.execute_byte = byte;
            return .execute;
        }
        self.state = .csi_ignore;
        return .none;
    }

    // -- CSI ignore --

    fn handleCsiIgnore(self: *Parser, byte: u8) Action {
        if (byte >= 0x40 and byte <= 0x7E) {
            self.state = .ground;
        }
        return .none;
    }

    // -- OSC string --

    fn handleOscString(self: *Parser, byte: u8) Action {
        if (byte == 0x07) {
            self.state = .ground;
            self.osc_bel = true;
            return .osc_dispatch;
        }
        if (byte >= 0x20 and byte != 0x7F) {
            if (self.osc_len < MAX_OSC) {
                self.osc_data[self.osc_len] = byte;
                self.osc_len += 1;
            } else {
                self.osc_truncated = true;
            }
        }
        return .none;
    }

    fn handleApcString(self: *Parser, byte: u8) Action {
        if (byte >= 0x20 and byte != 0x7F) {
            if (self.apc_len < MAX_APC) {
                self.apc_len += 1;
            } else {
                self.apc_truncated = true;
            }
        }
        return .none;
    }

    fn handleApcEscape(self: *Parser, byte: u8) Action {
        if (byte == '\\') {
            self.state = .ground;
            return .unsupported_apc;
        }
        self.state = .ground;
        // An ESC that is not followed by ST starts a fresh escape sequence;
        // reprocess its following byte so malformed APC data cannot swallow
        // an ordinary CSI/ESC command.
        return self.handleEscape(byte);
    }

    // -- Helpers --

    fn collectIntermediate(self: *Parser, byte: u8) void {
        if (self.intermediate_count < MAX_INTERMEDIATES) {
            self.intermediates[self.intermediate_count] = byte;
            self.intermediate_count += 1;
        }
    }

    pub fn getParam(self: *const Parser, idx: u8, default: u16) u16 {
        if (idx >= self.param_count) return default;
        const val = self.params[idx];
        return if (val == 0) default else val;
    }
};

/// Bytes in the UTF-8 sequence a lead byte starts, as the ground state reads it; 0 when not a lead.
pub fn utf8SequenceLength(lead: u8) u8 {
    if (lead >= 0xC2 and lead <= 0xDF) return 2;
    if (lead >= 0xE0 and lead <= 0xEF) return 3;
    if (lead >= 0xF0 and lead <= 0xF4) return 4;
    return 0;
}

/// Decodes one complete sequence, or null when it is not a well-formed
/// encoding of a Unicode scalar value: overlong, surrogate, or above U+10FFFF.
pub fn decodeUtf8(bytes: []const u8) ?u21 {
    if (bytes.len < 2 or bytes.len > 4) return null;
    if (utf8SequenceLength(bytes[0]) != bytes.len) return null;
    for (bytes[1..]) |b| if (b < 0x80 or b > 0xBF) return null;
    const cp: u21 = switch (bytes.len) {
        2 => (@as(u21, bytes[0] & 0x1F) << 6) | (bytes[1] & 0x3F),
        3 => (@as(u21, bytes[0] & 0x0F) << 12) | (@as(u21, bytes[1] & 0x3F) << 6) | (bytes[2] & 0x3F),
        4 => (@as(u21, bytes[0] & 0x07) << 18) | (@as(u21, bytes[1] & 0x3F) << 12) |
            (@as(u21, bytes[2] & 0x3F) << 6) | (bytes[3] & 0x3F),
        else => unreachable,
    };
    const min: u21 = switch (bytes.len) {
        2 => 0x80,
        3 => 0x800,
        else => 0x10000,
    };
    if (cp < min or cp > 0x10FFFF) return null;
    if (cp >= 0xD800 and cp <= 0xDFFF) return null;
    return cp;
}

test "bulk CSI parameters match bytewise parsing across every split" {
    const testing = @import("std").testing;
    const inputs = [_][]const u8{
        "m",
        ";m",
        "1;;3;m",
        "38;2;12;34;56;48;2;78;90;123m",
        "38;5;255;48;5;16m",
        "4:0;38:2::12:34:56m\x1b[4;0m",
        "65534;65535;65536;999999999999m",
        "0;" ** 15 ++ "1;2m",
        "0;" ** 15 ++ "1:2m",
        "12?3>4m",
        "<1;2=3m",
        "!p",
        "12\x073m",
        "1\x182m",
        "1\x1a2m",
        "12\x1b[3m",
        "5 q",
        "1$2mX",
        "1\x7f2mX",
        "1\x802mX",
    };
    for (inputs) |input| {
        for (0..input.len + 1) |split| {
            var fast = Parser{};
            var slow = Parser{};
            for ("\x1b[") |byte| {
                _ = fast.feed(byte);
                _ = slow.feed(byte);
            }
            for ([_][]const u8{ input[0..split], input[split..] }) |chunk| {
                var offset: usize = 0;
                while (offset < chunk.len) {
                    if (fast.state == .csi_param) {
                        const count = fast.feedCsiParams(chunk[offset..]);
                        for (chunk[offset .. offset + count]) |byte| {
                            try testing.expectEqual(Action.none, slow.feed(byte));
                        }
                        offset += count;
                    }
                    try testing.expectEqualDeep(slow.params, fast.params);
                    try testing.expectEqualDeep(slow.subparam, fast.subparam);
                    try testing.expectEqual(slow.param_count, fast.param_count);
                    try testing.expectEqual(slow.params_full, fast.params_full);
                    if (offset < chunk.len) {
                        const byte = chunk[offset];
                        try testing.expectEqual(slow.feed(byte), fast.feed(byte));
                        try testing.expectEqual(slow.print_char, fast.print_char);
                        try testing.expectEqual(slow.execute_byte, fast.execute_byte);
                        offset += 1;
                    }
                }
                try testing.expectEqual(slow.state, fast.state);
                try testing.expectEqual(slow.csi_private, fast.csi_private);
                try testing.expectEqual(slow.intermediate_count, fast.intermediate_count);
                try testing.expectEqualDeep(slow.intermediates, fast.intermediates);
            }
        }
    }
}

test "OSC marks payloads that exceed the collection buffer as truncated" {
    const testing = @import("std").testing;
    var parser = Parser{};
    _ = parser.feed(0x1b);
    _ = parser.feed(']');
    var i: usize = 0;
    while (i < MAX_OSC + 1) : (i += 1) {
        _ = parser.feed('x');
    }
    try testing.expect(parser.osc_truncated);
    try testing.expectEqual(MAX_OSC, parser.osc_len);
}

test "unsupported APC is consumed across split writes and resumes text" {
    const testing = @import("std").testing;
    var parser = Parser{};
    for ([_]u8{ 0x1b, '_' }) |byte| try testing.expectEqual(Action.none, parser.feed(byte));
    for ("Gf=100;QUJD") |byte| try testing.expectEqual(Action.none, parser.feed(byte));
    try testing.expectEqual(Action.none, parser.feed(0x1b));
    try testing.expectEqual(Action.unsupported_apc, parser.feed('\\'));
    try testing.expectEqual(Action.print, parser.feed('X'));
    try testing.expectEqual(@as(u21, 'X'), parser.print_char);
}

/// Feeds every byte and collects what the terminal would print, replacement
/// characters included, in order.
fn collectPrinted(parser: *Parser, bytes: []const u8, out: *[16]u21) []const u21 {
    var count: usize = 0;
    for (bytes) |byte| {
        const action = parser.feed(byte);
        if (parser.takeReplacement()) {
            out[count] = 0xFFFD;
            count += 1;
        }
        if (action == .print) {
            out[count] = parser.print_char;
            count += 1;
        }
    }
    return out[0..count];
}

test "malformed UTF-8 prints one replacement per maximal subpart" {
    const testing = @import("std").testing;
    const replacement: u21 = 0xFFFD;
    const cases = [_]struct { bytes: []const u8, expected: []const u21 }{
        // Lead byte above the four-byte range.
        .{ .bytes = &.{ 0xF7, 0xBF, 0xBF, 0xBF }, .expected = &.{ replacement, replacement, replacement, replacement } },
        // Four-byte sequence above U+10FFFF.
        .{ .bytes = &.{ 0xF4, 0x90, 0x80, 0x80 }, .expected = &.{ replacement, replacement, replacement, replacement } },
        // Overlong two-byte encodings, including C0/C1 which never lead.
        .{ .bytes = &.{ 0xC0, 0x80 }, .expected = &.{ replacement, replacement } },
        .{ .bytes = &.{ 0xC1, 0xBF }, .expected = &.{ replacement, replacement } },
        // Overlong three-byte encoding.
        .{ .bytes = &.{ 0xE0, 0x80, 0x80 }, .expected = &.{ replacement, replacement, replacement } },
        // Surrogate U+D800.
        .{ .bytes = &.{ 0xED, 0xA0, 0x80 }, .expected = &.{ replacement, replacement, replacement } },
        // Overlong four-byte encoding.
        .{ .bytes = &.{ 0xF0, 0x80, 0x80, 0x80 }, .expected = &.{ replacement, replacement, replacement, replacement } },
        // Stray continuation bytes.
        .{ .bytes = &.{ 0x80, 0xBF }, .expected = &.{ replacement, replacement } },
        // Truncated prefix abandoned by a printable byte.
        .{ .bytes = &.{ 0xE2, 0x82, 'A' }, .expected = &.{ replacement, 'A' } },
    };
    for (cases) |case| {
        var parser = Parser{};
        var printed: [16]u21 = undefined;
        try testing.expectEqualSlices(u21, case.expected, collectPrinted(&parser, case.bytes, &printed));
        try testing.expectEqual(State.ground, parser.state);
    }
}

test "well-formed UTF-8 sequences print unchanged" {
    const testing = @import("std").testing;
    const cases = [_]struct { bytes: []const u8, expected: u21 }{
        .{ .bytes = &.{ 0xC3, 0xA9 }, .expected = 0xE9 },
        .{ .bytes = &.{ 0xE2, 0x82, 0xAC }, .expected = 0x20AC },
        .{ .bytes = &.{ 0xE0, 0xA0, 0x80 }, .expected = 0x800 },
        .{ .bytes = &.{ 0xF0, 0x90, 0x80, 0x80 }, .expected = 0x10000 },
        .{ .bytes = &.{ 0xF0, 0x9F, 0x98, 0x80 }, .expected = 0x1F600 },
        .{ .bytes = &.{ 0xF4, 0x8F, 0xBF, 0xBF }, .expected = 0x10FFFF },
    };
    for (cases) |case| {
        var parser = Parser{};
        var printed: [16]u21 = undefined;
        try testing.expectEqualSlices(u21, &.{case.expected}, collectPrinted(&parser, case.bytes, &printed));
        try testing.expectEqual(State.ground, parser.state);
    }
}

test "a sequence split across feeds is held until it completes" {
    const testing = @import("std").testing;
    var parser = Parser{};
    var printed: [16]u21 = undefined;
    try testing.expectEqualSlices(u21, &.{}, collectPrinted(&parser, &.{ 0xE2 }, &printed));
    try testing.expectEqual(State.utf8, parser.state);
    try testing.expectEqualSlices(u21, &.{}, collectPrinted(&parser, &.{ 0x82 }, &printed));
    try testing.expectEqual(State.utf8, parser.state);
    try testing.expectEqualSlices(u21, &.{0x20AC}, collectPrinted(&parser, &.{ 0xAC }, &printed));
    try testing.expectEqual(State.ground, parser.state);
}

test "control bytes end a truncated sequence with one replacement" {
    const testing = @import("std").testing;
    const replacement: u21 = 0xFFFD;
    inline for ([_]u8{ 0x18, 0x1A }) |control| {
        var parser = Parser{};
        var printed: [16]u21 = undefined;
        try testing.expectEqualSlices(u21, &.{replacement}, collectPrinted(&parser, &.{ 0xE2, 0x82, control }, &printed));
        try testing.expectEqual(State.ground, parser.state);
    }
    var parser = Parser{};
    var printed: [16]u21 = undefined;
    try testing.expectEqualSlices(u21, &.{replacement}, collectPrinted(&parser, &.{ 0xE2, 0x82, 0x1B }, &printed));
    try testing.expectEqual(State.escape, parser.state);
    try testing.expectEqual(Action.none, parser.feed('['));
    try testing.expectEqual(State.csi_param, parser.state);
}

test "decodeUtf8 rejects every non-scalar encoding" {
    const testing = @import("std").testing;
    const invalid = [_][]const u8{
        &.{ 0xF7, 0xBF, 0xBF, 0xBF },
        &.{ 0xF4, 0x90, 0x80, 0x80 },
        &.{ 0xC0, 0x80 },
        &.{ 0xC1, 0xBF },
        &.{ 0xE0, 0x80, 0x80 },
        &.{ 0xED, 0xA0, 0x80 },
        &.{ 0xED, 0xBF, 0xBF },
        &.{ 0xF0, 0x80, 0x80, 0x80 },
        &.{ 0xE2, 0x82 },
        &.{0x80},
    };
    for (invalid) |bytes| try testing.expectEqual(@as(?u21, null), decodeUtf8(bytes));

    const valid = [_]struct { bytes: []const u8, cp: u21 }{
        .{ .bytes = &.{ 0xC2, 0x80 }, .cp = 0x80 },
        .{ .bytes = &.{ 0xDF, 0xBF }, .cp = 0x7FF },
        .{ .bytes = &.{ 0xE0, 0xA0, 0x80 }, .cp = 0x800 },
        .{ .bytes = &.{ 0xED, 0x9F, 0xBF }, .cp = 0xD7FF },
        .{ .bytes = &.{ 0xEE, 0x80, 0x80 }, .cp = 0xE000 },
        .{ .bytes = &.{ 0xF0, 0x90, 0x80, 0x80 }, .cp = 0x10000 },
        .{ .bytes = &.{ 0xF4, 0x8F, 0xBF, 0xBF }, .cp = 0x10FFFF },
    };
    for (valid) |case| try testing.expectEqual(@as(?u21, case.cp), decodeUtf8(case.bytes));
}

test "cancelled and oversized APC payloads do not leak bytes" {
    const testing = @import("std").testing;
    var parser = Parser{};
    for ([_]u8{ 0x1b, '_' }) |byte| _ = parser.feed(byte);
    for (0..MAX_APC + 100) |_| _ = parser.feed('A');
    try testing.expect(parser.apc_truncated);
    _ = parser.feed(0x18);
    try testing.expectEqual(State.ground, parser.state);
    try testing.expectEqual(Action.print, parser.feed('Z'));

    for ([_]u8{ 0x1b, '_' }) |byte| _ = parser.feed(byte);
    _ = parser.feed('G');
    _ = parser.feed(0x1a);
    try testing.expectEqual(State.ground, parser.state);
    try testing.expectEqual(Action.print, parser.feed('Y'));
}
