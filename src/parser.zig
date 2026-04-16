pub const MAX_PARAMS: u8 = 16;
pub const MAX_INTERMEDIATES: u8 = 2;
pub const MAX_OSC: u16 = 512;

pub const Action = enum {
    none,
    print,
    execute,
    csi_dispatch,
    esc_dispatch,
    osc_dispatch,
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
    intermediates: [MAX_INTERMEDIATES]u8 = [_]u8{0} ** MAX_INTERMEDIATES,
    intermediate_count: u8 = 0,
    csi_private: u8 = 0,

    // OSC collected data
    osc_data: [MAX_OSC]u8 = undefined,
    osc_len: u16 = 0,

    // UTF-8 decoder
    utf8_buf: [4]u8 = undefined,
    utf8_remaining: u3 = 0,
    utf8_expected: u3 = 0,

    pub fn feed(self: *Parser, byte: u8) Action {
        // ESC always starts a new sequence (except in OSC where ST = ESC \ terminates)
        if (byte == 0x1B) {
            if (self.state == .osc_string) {
                self.state = .escape;
                return .osc_dispatch;
            }
            self.enterEscape();
            return .none;
        }

        // CAN (0x18) and SUB (0x1A) cancel any sequence
        if (byte == 0x18 or byte == 0x1A) {
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
        };
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

        // UTF-8 multi-byte sequences
        if (byte >= 0xC0 and byte <= 0xDF) {
            self.utf8_buf[0] = byte;
            self.utf8_expected = 2;
            self.utf8_remaining = 1;
            self.state = .utf8;
            return .none;
        }
        if (byte >= 0xE0 and byte <= 0xEF) {
            self.utf8_buf[0] = byte;
            self.utf8_expected = 3;
            self.utf8_remaining = 2;
            self.state = .utf8;
            return .none;
        }
        if (byte >= 0xF0 and byte <= 0xF7) {
            self.utf8_buf[0] = byte;
            self.utf8_expected = 4;
            self.utf8_remaining = 3;
            self.state = .utf8;
            return .none;
        }

        return .none;
    }

    // -- UTF-8 continuation --

    fn handleUtf8(self: *Parser, byte: u8) Action {
        if (byte >= 0x80 and byte <= 0xBF) {
            const idx = self.utf8_expected - self.utf8_remaining;
            self.utf8_buf[idx] = byte;
            self.utf8_remaining -= 1;
            if (self.utf8_remaining == 0) {
                self.print_char = decodeUtf8(self.utf8_buf[0..self.utf8_expected]);
                self.state = .ground;
                return .print;
            }
            return .none;
        }
        // Invalid continuation: go back to ground and reprocess
        self.state = .ground;
        return self.handleGround(byte);
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
        if (byte == ';') {
            if (self.param_count < MAX_PARAMS) {
                if (self.param_count == 0) self.param_count = 1;
                self.param_count += 1;
                if (self.param_count > MAX_PARAMS) {
                    self.param_count = MAX_PARAMS;
                    self.params_full = true;
                }
            }
            return .none;
        }
        if (byte == '?' or byte == '>' or byte == '!') {
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
            return .osc_dispatch;
        }
        if (byte >= 0x20 and byte <= 0x7E) {
            if (self.osc_len < MAX_OSC) {
                self.osc_data[self.osc_len] = byte;
                self.osc_len += 1;
            }
        }
        return .none;
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

fn decodeUtf8(bytes: []const u8) u21 {
    if (bytes.len == 0) return 0xFFFD;
    return switch (bytes.len) {
        2 => {
            const b0: u21 = bytes[0] & 0x1F;
            const b1: u21 = bytes[1] & 0x3F;
            return (b0 << 6) | b1;
        },
        3 => {
            const b0: u21 = bytes[0] & 0x0F;
            const b1: u21 = bytes[1] & 0x3F;
            const b2: u21 = bytes[2] & 0x3F;
            return (b0 << 12) | (b1 << 6) | b2;
        },
        4 => {
            const b0: u21 = bytes[0] & 0x07;
            const b1: u21 = bytes[1] & 0x3F;
            const b2: u21 = bytes[2] & 0x3F;
            const b3: u21 = bytes[3] & 0x3F;
            return (b0 << 18) | (b1 << 12) | (b2 << 6) | b3;
        },
        else => 0xFFFD,
    };
}
