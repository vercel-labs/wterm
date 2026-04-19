const cell_mod = @import("cell.zig");
const grid_mod = @import("grid.zig");
const parser_mod = @import("parser.zig");
const scrollback_mod = @import("scrollback.zig");

const Cell = cell_mod.Cell;
const Grid = grid_mod.Grid;
const Parser = parser_mod.Parser;
const Action = parser_mod.Action;
const Scrollback = scrollback_mod.Scrollback;

pub const DEBUG_LOG_MAX: u8 = 32;

pub const DebugLogEntry = struct {
    final_byte: u8 = 0,
    private_marker: u8 = 0,
    param_count: u8 = 0,
    _pad: u8 = 0,
    params: [4]u16 = [_]u16{0} ** 4,
};

comptime {
    if (@sizeOf(DebugLogEntry) != 12)
        @compileError("DebugLogEntry size changed — update wasm-bridge.ts entrySize");
}

pub const Terminal = struct {
    grid: Grid,
    parser: Parser = .{},
    scrollback: ?*Scrollback = null,

    cols: u16,
    rows: u16,

    cursor_row: u16 = 0,
    cursor_col: u16 = 0,
    cursor_visible: bool = true,
    wrap_pending: bool = false,

    saved_cursor_row: u16 = 0,
    saved_cursor_col: u16 = 0,
    saved_fg: u16 = cell_mod.DEFAULT_COLOR,
    saved_bg: u16 = cell_mod.DEFAULT_COLOR,
    saved_flags: u8 = 0,

    current_fg: u16 = cell_mod.DEFAULT_COLOR,
    current_bg: u16 = cell_mod.DEFAULT_COLOR,
    current_flags: u8 = 0,

    scroll_top: u16 = 0,
    scroll_bottom: u16 = 0,

    auto_wrap: bool = true,
    origin_mode: bool = false,
    cursor_keys_app: bool = false,
    bracketed_paste: bool = false,
    linefeed_mode: bool = false,

    // Alternate screen buffer (pointer to avoid doubling struct size)
    alt_grid: ?*Grid = null,
    alt_saved_cursor_row: u16 = 0,
    alt_saved_cursor_col: u16 = 0,
    alt_saved_fg: u16 = cell_mod.DEFAULT_COLOR,
    alt_saved_bg: u16 = cell_mod.DEFAULT_COLOR,
    alt_saved_flags: u8 = 0,
    using_alt_screen: bool = false,

    // Title (from OSC 0 / 2)
    title_buf: [256]u8 = undefined,
    title_len: u16 = 0,
    title_changed: bool = false,

    // Response buffer for DSR and similar host-to-application replies
    response_buf: [64]u8 = undefined,
    response_len: u8 = 0,

    // Ring buffer of unhandled/ignored CSI sequences for debug introspection
    debug_log: [DEBUG_LOG_MAX]DebugLogEntry = [_]DebugLogEntry{.{}} ** DEBUG_LOG_MAX,
    debug_log_idx: u8 = 0,
    debug_log_count: u32 = 0,

    tab_stops: [grid_mod.MAX_COLS]u8 = initTabStops(),

    pub fn init(cols: u16, rows: u16) Terminal {
        return Terminal{
            .grid = Grid.init(cols, rows),
            .cols = cols,
            .rows = rows,
            .scroll_bottom = rows,
        };
    }

    /// Returns a blank (space) cell carrying only the current SGR background.
    /// Foreground and flags are intentionally omitted: ECMA-48 BCE specifies
    /// that erased cells inherit only the background color, not other attrs.
    fn blankCell(self: *const Terminal) Cell {
        return Cell{ .bg = self.current_bg };
    }

    fn logUnhandled(self: *Terminal, final: u8, private_marker: u8) void {
        var entry = DebugLogEntry{
            .final_byte = final,
            .private_marker = private_marker,
        };
        entry.param_count = self.parser.param_count;
        const copy_count: u8 = if (self.parser.param_count > 4) 4 else self.parser.param_count;
        var i: u8 = 0;
        while (i < copy_count) : (i += 1) {
            entry.params[i] = self.parser.params[i];
        }
        self.debug_log[self.debug_log_idx] = entry;
        self.debug_log_idx = (self.debug_log_idx + 1) % DEBUG_LOG_MAX;
        self.debug_log_count +|= 1;
    }

    /// Reset in-place without creating large stack temporaries.
    /// Preserves scrollback and alt_grid pointers (set by the host layer).
    pub fn reset(self: *Terminal, cols: u16, rows: u16) void {
        self.grid.reset(cols, rows);
        self.parser = .{};
        self.cols = cols;
        self.rows = rows;
        self.cursor_row = 0;
        self.cursor_col = 0;
        self.cursor_visible = true;
        self.wrap_pending = false;
        self.saved_cursor_row = 0;
        self.saved_cursor_col = 0;
        self.saved_fg = cell_mod.DEFAULT_COLOR;
        self.saved_bg = cell_mod.DEFAULT_COLOR;
        self.saved_flags = 0;
        self.current_fg = cell_mod.DEFAULT_COLOR;
        self.current_bg = cell_mod.DEFAULT_COLOR;
        self.current_flags = 0;
        self.scroll_top = 0;
        self.scroll_bottom = rows;
        self.auto_wrap = true;
        self.origin_mode = false;
        self.cursor_keys_app = false;
        self.bracketed_paste = false;
        self.linefeed_mode = false;
        self.alt_saved_cursor_row = 0;
        self.alt_saved_cursor_col = 0;
        self.alt_saved_fg = cell_mod.DEFAULT_COLOR;
        self.alt_saved_bg = cell_mod.DEFAULT_COLOR;
        self.alt_saved_flags = 0;
        self.using_alt_screen = false;
        self.title_len = 0;
        self.title_changed = false;
        self.response_len = 0;
        self.tab_stops = initTabStops();
    }

    // -- Public API --

    pub fn write(self: *Terminal, data: []const u8) void {
        for (data) |byte| {
            self.processByte(byte);
        }
    }

    pub fn resize(self: *Terminal, new_cols: u16, new_rows: u16) void {
        const cols = if (new_cols > grid_mod.MAX_COLS) grid_mod.MAX_COLS else if (new_cols == 0) 1 else new_cols;
        const rows = if (new_rows > grid_mod.MAX_ROWS) grid_mod.MAX_ROWS else if (new_rows == 0) 1 else new_rows;

        const old_cols = self.cols;
        const old_rows = self.rows;

        if (cols == old_cols and rows == old_rows) return;

        // Clear cells beyond the new column width for each preserved row
        if (cols < old_cols) {
            const preserve_rows = if (rows < old_rows) rows else old_rows;
            var r: u16 = 0;
            while (r < preserve_rows) : (r += 1) {
                var c: u16 = cols;
                while (c < old_cols) : (c += 1) {
                    self.grid.cells[r][c] = Cell{};
                }
            }
        }

        // Push excess bottom rows into scrollback when shrinking vertically
        if (rows < old_rows) {
            if (!self.using_alt_screen and self.scrollback != null) {
                var r: u16 = rows;
                while (r < old_rows) : (r += 1) {
                    self.scrollback.?.push(&self.grid.cells[r], if (cols < old_cols) cols else old_cols);
                }
            }
        }

        self.cols = cols;
        self.rows = rows;
        self.grid.cols = cols;
        self.grid.rows = rows;

        // Clear any newly exposed rows when growing vertically
        if (rows > old_rows) {
            var r: u16 = old_rows;
            while (r < rows) : (r += 1) {
                self.grid.clearRow(r);
            }
        }

        // Clear newly exposed columns when growing horizontally
        if (cols > old_cols) {
            const preserve_rows = if (old_rows < rows) old_rows else rows;
            var r2: u16 = 0;
            while (r2 < preserve_rows) : (r2 += 1) {
                var c: u16 = old_cols;
                while (c < cols) : (c += 1) {
                    self.grid.cells[r2][c] = Cell{};
                }
                self.grid.dirty[r2] = 1;
            }
        }
        self.scroll_top = 0;
        self.scroll_bottom = rows;

        if (self.cursor_col >= cols) self.cursor_col = cols - 1;
        if (self.cursor_row >= rows) self.cursor_row = rows - 1;

        // Mark all rows dirty so the renderer picks up the changes
        var r: u16 = 0;
        while (r < rows) : (r += 1) {
            self.grid.dirty[r] = 1;
        }
    }

    // -- Byte processing --

    fn processByte(self: *Terminal, byte: u8) void {
        const action = self.parser.feed(byte);
        switch (action) {
            .none => {},
            .print => self.printChar(self.parser.print_char),
            .execute => self.executeControl(self.parser.execute_byte),
            .csi_dispatch => self.handleCsi(),
            .esc_dispatch => self.handleEsc(),
            .osc_dispatch => self.handleOsc(),
        }
    }

    // -- Print --

    fn printChar(self: *Terminal, codepoint: u21) void {
        if (self.wrap_pending) {
            self.cursor_col = 0;
            self.doLinefeed();
            self.wrap_pending = false;
        }

        self.grid.setCell(self.cursor_row, self.cursor_col, Cell{
            .char = @intCast(codepoint),
            .fg = self.current_fg,
            .bg = self.current_bg,
            .flags = self.current_flags,
        });

        if (self.cursor_col < self.cols - 1) {
            self.cursor_col += 1;
        } else if (self.auto_wrap) {
            self.wrap_pending = true;
        }
    }

    // -- C0 control codes --

    fn executeControl(self: *Terminal, byte: u8) void {
        switch (byte) {
            0x07 => {}, // BEL
            0x08, 0x7F => self.backspace(),
            0x09 => self.horizontalTab(),
            0x0A, 0x0B, 0x0C => {
                self.doLinefeed();
                if (self.linefeed_mode) self.carriageReturn();
            },
            0x0D => self.carriageReturn(),
            else => {},
        }
    }

    fn backspace(self: *Terminal) void {
        if (self.cursor_col > 0) {
            self.cursor_col -= 1;
            self.wrap_pending = false;
        }
    }

    fn horizontalTab(self: *Terminal) void {
        var col = self.cursor_col + 1;
        while (col < self.cols) : (col += 1) {
            if (self.tab_stops[col] == 1) break;
        }
        self.cursor_col = if (col >= self.cols) self.cols - 1 else col;
        self.wrap_pending = false;
    }

    fn doLinefeed(self: *Terminal) void {
        if (self.cursor_row + 1 >= self.scroll_bottom) {
            if (!self.using_alt_screen and self.scroll_top == 0) {
                if (self.scrollback) |sb| {
                    sb.push(&self.grid.cells[self.scroll_top], self.cols);
                }
            }
            self.grid.scrollUp(self.scroll_top, self.scroll_bottom, 1, self.blankCell());
        } else {
            self.cursor_row += 1;
        }
    }

    fn carriageReturn(self: *Terminal) void {
        self.cursor_col = 0;
        self.wrap_pending = false;
    }

    // -- ESC dispatch --

    fn handleEsc(self: *Terminal) void {
        const byte = self.parser.execute_byte;
        const has_inter = self.parser.intermediate_count > 0;
        const inter0 = if (has_inter) self.parser.intermediates[0] else @as(u8, 0);

        if (has_inter and inter0 == '#' and byte == '8') {
            self.decaln();
            return;
        }

        switch (byte) {
            '7' => self.saveCursor(),
            '8' => self.restoreCursor(),
            'D' => self.doLinefeed(),
            'E' => {
                self.carriageReturn();
                self.doLinefeed();
            },
            'M' => self.reverseIndex(),
            'c' => self.fullReset(),
            'H' => self.setTabStop(),
            else => {},
        }
    }

    fn decaln(self: *Terminal) void {
        var r: u16 = 0;
        while (r < self.rows) : (r += 1) {
            var c: u16 = 0;
            while (c < self.cols) : (c += 1) {
                self.grid.setCell(r, c, Cell{ .char = 'E' });
            }
        }
        self.cursor_row = 0;
        self.cursor_col = 0;
    }

    fn setTabStop(self: *Terminal) void {
        if (self.cursor_col < grid_mod.MAX_COLS) {
            self.tab_stops[self.cursor_col] = 1;
        }
    }

    fn saveCursor(self: *Terminal) void {
        self.saved_cursor_row = self.cursor_row;
        self.saved_cursor_col = self.cursor_col;
        self.saved_fg = self.current_fg;
        self.saved_bg = self.current_bg;
        self.saved_flags = self.current_flags;
    }

    fn restoreCursor(self: *Terminal) void {
        self.cursor_row = self.saved_cursor_row;
        self.cursor_col = self.saved_cursor_col;
        self.current_fg = self.saved_fg;
        self.current_bg = self.saved_bg;
        self.current_flags = self.saved_flags;
        self.wrap_pending = false;
    }

    fn reverseIndex(self: *Terminal) void {
        if (self.cursor_row == self.scroll_top) {
            self.grid.scrollDown(self.scroll_top, self.scroll_bottom, 1, self.blankCell());
        } else if (self.cursor_row > 0) {
            self.cursor_row -= 1;
        }
    }

    fn fullReset(self: *Terminal) void {
        self.reset(self.cols, self.rows);
    }

    // -- CSI dispatch --

    fn handleCsi(self: *Terminal) void {
        const final = self.parser.execute_byte;

        if (self.parser.csi_private == '?') {
            self.handlePrivateMode(final);
            return;
        }
        if (self.parser.csi_private == '!' and final == 'p') {
            self.softReset();
            return;
        }
        if (self.parser.csi_private == '>') {
            self.logUnhandled(final, '>');
            return;
        }

        switch (final) {
            'A' => self.cursorUp(self.parser.getParam(0, 1)),
            'B' => self.cursorDown(self.parser.getParam(0, 1)),
            'C' => self.cursorForward(self.parser.getParam(0, 1)),
            'D' => self.cursorBackward(self.parser.getParam(0, 1)),
            'E' => {
                self.cursorDown(self.parser.getParam(0, 1));
                self.cursor_col = 0;
            },
            'F' => {
                self.cursorUp(self.parser.getParam(0, 1));
                self.cursor_col = 0;
            },
            'G' => self.cursorToColumn(self.parser.getParam(0, 1)),
            'H', 'f' => self.cursorPosition(self.parser.getParam(0, 1), self.parser.getParam(1, 1)),
            'J' => self.eraseInDisplay(self.parser.getParam(0, 0)),
            'K' => self.eraseInLine(self.parser.getParam(0, 0)),
            'L' => self.insertLines(self.parser.getParam(0, 1)),
            'M' => self.deleteLines(self.parser.getParam(0, 1)),
            'P' => self.deleteChars(self.parser.getParam(0, 1)),
            'S' => self.scrollUpN(self.parser.getParam(0, 1)),
            'T' => self.scrollDownN(self.parser.getParam(0, 1)),
            'X' => self.eraseChars(self.parser.getParam(0, 1)),
            'a' => self.cursorForward(self.parser.getParam(0, 1)),
            'd' => self.cursorToRow(self.parser.getParam(0, 1)),
            'e' => self.cursorDown(self.parser.getParam(0, 1)),
            'g' => self.clearTabStop(self.parser.getParam(0, 0)),
            'm' => self.handleSgr(),
            'n' => self.handleDeviceStatus(),
            'r' => self.setScrollRegion(self.parser.getParam(0, 1), self.parser.getParam(1, self.rows)),
            's' => self.saveCursor(),
            't' => {}, // window manipulation - ignore
            'u' => self.restoreCursor(),
            '@' => self.insertBlanks(self.parser.getParam(0, 1)),
            '`' => self.cursorToColumn(self.parser.getParam(0, 1)),
            else => self.logUnhandled(final, 0),
        }
    }

    fn handlePrivateMode(self: *Terminal, final: u8) void {
        switch (final) {
            'h' => self.setPrivateMode(true),
            'l' => self.setPrivateMode(false),
            else => self.logUnhandled(final, '?'),
        }
    }

    fn setPrivateMode(self: *Terminal, enabled: bool) void {
        var i: u8 = 0;
        const count = if (self.parser.param_count == 0) @as(u8, 1) else self.parser.param_count;
        while (i < count) : (i += 1) {
            const mode = self.parser.params[i];
            switch (mode) {
                1 => self.cursor_keys_app = enabled,
                6 => self.origin_mode = enabled,
                7 => self.auto_wrap = enabled,
                12 => {}, // cursor blink - handled by renderer
                20 => self.linefeed_mode = enabled,
                25 => self.cursor_visible = enabled,
                47 => self.switchScreen(enabled, false),
                1047 => self.switchScreen(enabled, false),
                1048 => {
                    if (enabled) self.saveCursor() else self.restoreCursor();
                },
                1049 => self.switchScreen(enabled, true),
                2004 => self.bracketed_paste = enabled,
                else => {},
            }
        }
    }

    fn switchScreen(self: *Terminal, alt: bool, save_cursor: bool) void {
        if (alt == self.using_alt_screen) return;
        const ag = self.alt_grid orelse return;

        if (alt) {
            if (save_cursor) self.saveCursorToAlt();
            ag.* = self.grid;
            self.grid.reset(self.cols, self.rows);
            self.using_alt_screen = true;
        } else {
            self.grid = ag.*;
            self.using_alt_screen = false;
            if (save_cursor) self.restoreCursorFromAlt();
            var r: u16 = 0;
            while (r < self.rows) : (r += 1) {
                self.grid.dirty[r] = 1;
            }
        }
        self.scroll_top = 0;
        self.scroll_bottom = self.rows;
    }

    fn saveCursorToAlt(self: *Terminal) void {
        self.alt_saved_cursor_row = self.cursor_row;
        self.alt_saved_cursor_col = self.cursor_col;
        self.alt_saved_fg = self.current_fg;
        self.alt_saved_bg = self.current_bg;
        self.alt_saved_flags = self.current_flags;
    }

    fn restoreCursorFromAlt(self: *Terminal) void {
        self.cursor_row = self.alt_saved_cursor_row;
        self.cursor_col = self.alt_saved_cursor_col;
        self.current_fg = self.alt_saved_fg;
        self.current_bg = self.alt_saved_bg;
        self.current_flags = self.alt_saved_flags;
        self.wrap_pending = false;
    }

    fn softReset(self: *Terminal) void {
        self.cursor_visible = true;
        self.origin_mode = false;
        self.auto_wrap = true;
        self.cursor_keys_app = false;
        self.bracketed_paste = false;
        self.scroll_top = 0;
        self.scroll_bottom = self.rows;
        self.resetStyle();
    }

    fn handleDeviceStatus(self: *Terminal) void {
        const param = self.parser.getParam(0, 0);
        if (param == 6) {
            // CPR – Cursor Position Report: ESC [ row ; col R
            const row = self.cursor_row + 1;
            const col = self.cursor_col + 1;
            var buf: [64]u8 = undefined;
            var len: u8 = 0;
            buf[len] = 0x1B;
            len += 1;
            buf[len] = '[';
            len += 1;
            len = appendU16(buf[0..], len, row);
            buf[len] = ';';
            len += 1;
            len = appendU16(buf[0..], len, col);
            buf[len] = 'R';
            len += 1;
            self.response_buf = buf;
            self.response_len = len;
        }
    }

    // -- Cursor movement --

    fn cursorUp(self: *Terminal, n: u16) void {
        const amount = if (n == 0) 1 else n;
        self.cursor_row = if (amount > self.cursor_row) 0 else self.cursor_row - amount;
        self.wrap_pending = false;
    }

    fn cursorDown(self: *Terminal, n: u16) void {
        const amount = if (n == 0) 1 else n;
        const max = self.rows - 1;
        self.cursor_row = if (self.cursor_row + amount > max) max else self.cursor_row + amount;
        self.wrap_pending = false;
    }

    fn cursorForward(self: *Terminal, n: u16) void {
        const amount = if (n == 0) 1 else n;
        const max = self.cols - 1;
        self.cursor_col = if (self.cursor_col + amount > max) max else self.cursor_col + amount;
        self.wrap_pending = false;
    }

    fn cursorBackward(self: *Terminal, n: u16) void {
        const amount = if (n == 0) 1 else n;
        self.cursor_col = if (amount > self.cursor_col) 0 else self.cursor_col - amount;
        self.wrap_pending = false;
    }

    fn cursorPosition(self: *Terminal, row_param: u16, col_param: u16) void {
        const r = if (row_param == 0) 0 else row_param - 1;
        const c = if (col_param == 0) 0 else col_param - 1;
        self.cursor_row = if (r >= self.rows) self.rows - 1 else r;
        self.cursor_col = if (c >= self.cols) self.cols - 1 else c;
        self.wrap_pending = false;
    }

    fn cursorToColumn(self: *Terminal, col_param: u16) void {
        const c = if (col_param == 0) 0 else col_param - 1;
        self.cursor_col = if (c >= self.cols) self.cols - 1 else c;
        self.wrap_pending = false;
    }

    fn cursorToRow(self: *Terminal, row_param: u16) void {
        const r = if (row_param == 0) 0 else row_param - 1;
        self.cursor_row = if (r >= self.rows) self.rows - 1 else r;
        self.wrap_pending = false;
    }

    // -- Erase operations --

    fn eraseInDisplay(self: *Terminal, mode: u16) void {
        const blank = self.blankCell();
        switch (mode) {
            0 => {
                self.grid.clearRangeAs(self.cursor_row, self.cursor_col, self.cols, blank);
                var r = self.cursor_row + 1;
                while (r < self.rows) : (r += 1) {
                    self.grid.clearRowAs(r, blank);
                }
            },
            1 => {
                var r: u16 = 0;
                while (r < self.cursor_row) : (r += 1) {
                    self.grid.clearRowAs(r, blank);
                }
                self.grid.clearRangeAs(self.cursor_row, 0, self.cursor_col + 1, blank);
            },
            2, 3 => {
                var r: u16 = 0;
                while (r < self.rows) : (r += 1) {
                    self.grid.clearRowAs(r, blank);
                }
                if (mode == 3) {
                    if (self.scrollback) |sb| sb.reset();
                }
            },
            else => {},
        }
    }

    fn eraseInLine(self: *Terminal, mode: u16) void {
        const blank = self.blankCell();
        switch (mode) {
            0 => self.grid.clearRangeAs(self.cursor_row, self.cursor_col, self.cols, blank),
            1 => self.grid.clearRangeAs(self.cursor_row, 0, self.cursor_col + 1, blank),
            2 => self.grid.clearRowAs(self.cursor_row, blank),
            else => {},
        }
    }

    fn eraseChars(self: *Terminal, n: u16) void {
        const count = if (n == 0) 1 else n;
        const end = if (self.cursor_col + count > self.cols) self.cols else self.cursor_col + count;
        self.grid.clearRangeAs(self.cursor_row, self.cursor_col, end, self.blankCell());
    }

    // -- Insert / delete --

    fn insertLines(self: *Terminal, n: u16) void {
        if (self.cursor_row < self.scroll_top or self.cursor_row >= self.scroll_bottom) return;
        self.grid.scrollDown(self.cursor_row, self.scroll_bottom, if (n == 0) 1 else n, self.blankCell());
    }

    fn deleteLines(self: *Terminal, n: u16) void {
        if (self.cursor_row < self.scroll_top or self.cursor_row >= self.scroll_bottom) return;
        self.grid.scrollUp(self.cursor_row, self.scroll_bottom, if (n == 0) 1 else n, self.blankCell());
    }

    fn deleteChars(self: *Terminal, n: u16) void {
        const count = if (n == 0) 1 else n;
        const blank = self.blankCell();
        var col = self.cursor_col;
        while (col + count < self.cols) : (col += 1) {
            self.grid.cells[self.cursor_row][col] = self.grid.cells[self.cursor_row][col + count];
        }
        while (col < self.cols) : (col += 1) {
            self.grid.cells[self.cursor_row][col] = blank;
        }
        self.grid.dirty[self.cursor_row] = 1;
    }

    fn insertBlanks(self: *Terminal, n: u16) void {
        const count = if (n == 0) 1 else n;
        const blank = self.blankCell();
        if (self.cursor_col + count >= self.cols) {
            self.grid.clearRangeAs(self.cursor_row, self.cursor_col, self.cols, blank);
            return;
        }
        var col = self.cols - 1;
        while (col >= self.cursor_col + count) : (col -= 1) {
            self.grid.cells[self.cursor_row][col] = self.grid.cells[self.cursor_row][col - count];
            if (col == 0) break;
        }
        var c = self.cursor_col;
        const end = if (self.cursor_col + count > self.cols) self.cols else self.cursor_col + count;
        while (c < end) : (c += 1) {
            self.grid.cells[self.cursor_row][c] = blank;
        }
        self.grid.dirty[self.cursor_row] = 1;
    }

    fn scrollUpN(self: *Terminal, n: u16) void {
        const count = if (n == 0) 1 else n;
        if (!self.using_alt_screen and self.scroll_top == 0) {
            if (self.scrollback) |sb| {
                var i: u16 = 0;
                while (i < count and i < self.scroll_bottom - self.scroll_top) : (i += 1) {
                    sb.push(&self.grid.cells[self.scroll_top + i], self.cols);
                }
            }
        }
        self.grid.scrollUp(self.scroll_top, self.scroll_bottom, count, self.blankCell());
    }

    fn scrollDownN(self: *Terminal, n: u16) void {
        self.grid.scrollDown(self.scroll_top, self.scroll_bottom, if (n == 0) 1 else n, self.blankCell());
    }

    // -- Scroll region --

    fn setScrollRegion(self: *Terminal, top_param: u16, bottom_param: u16) void {
        const top = if (top_param == 0) 0 else top_param - 1;
        const bottom = if (bottom_param > self.rows) self.rows else bottom_param;
        if (top < bottom) {
            self.scroll_top = top;
            self.scroll_bottom = bottom;
            self.cursor_row = if (self.origin_mode) top else 0;
            self.cursor_col = 0;
            self.wrap_pending = false;
        }
    }

    // -- Tab stops --

    fn clearTabStop(self: *Terminal, mode: u16) void {
        switch (mode) {
            0 => {
                if (self.cursor_col < grid_mod.MAX_COLS)
                    self.tab_stops[self.cursor_col] = 0;
            },
            3 => {
                var i: u16 = 0;
                while (i < grid_mod.MAX_COLS) : (i += 1) {
                    self.tab_stops[i] = 0;
                }
            },
            else => {},
        }
    }

    // -- SGR (Select Graphic Rendition) --

    fn handleSgr(self: *Terminal) void {
        if (self.parser.param_count == 0) {
            self.resetStyle();
            return;
        }

        var i: u8 = 0;
        while (i < self.parser.param_count) {
            const p = self.parser.params[i];
            switch (p) {
                0 => self.resetStyle(),
                1 => self.current_flags |= cell_mod.FLAG_BOLD,
                2 => self.current_flags |= cell_mod.FLAG_DIM,
                3 => self.current_flags |= cell_mod.FLAG_ITALIC,
                4 => {
                    if (i + 1 < self.parser.param_count and self.parser.subparam[i + 1]) {
                        const sub = self.parser.params[i + 1];
                        if (sub == 0) {
                            self.current_flags &= ~cell_mod.FLAG_UNDERLINE;
                        } else {
                            self.current_flags |= cell_mod.FLAG_UNDERLINE;
                        }
                        i += 1;
                    } else {
                        self.current_flags |= cell_mod.FLAG_UNDERLINE;
                    }
                },
                5 => self.current_flags |= cell_mod.FLAG_BLINK,
                7 => self.current_flags |= cell_mod.FLAG_REVERSE,
                8 => self.current_flags |= cell_mod.FLAG_INVISIBLE,
                9 => self.current_flags |= cell_mod.FLAG_STRIKETHROUGH,
                22 => self.current_flags &= ~(cell_mod.FLAG_BOLD | cell_mod.FLAG_DIM),
                23 => self.current_flags &= ~cell_mod.FLAG_ITALIC,
                24 => self.current_flags &= ~cell_mod.FLAG_UNDERLINE,
                25 => self.current_flags &= ~cell_mod.FLAG_BLINK,
                27 => self.current_flags &= ~cell_mod.FLAG_REVERSE,
                28 => self.current_flags &= ~cell_mod.FLAG_INVISIBLE,
                29 => self.current_flags &= ~cell_mod.FLAG_STRIKETHROUGH,
                30...37 => self.current_fg = @intCast(p - 30),
                38 => {
                    i += self.parseExtendedColor(i, &self.current_fg);
                },
                39 => self.current_fg = cell_mod.DEFAULT_COLOR,
                40...47 => self.current_bg = @intCast(p - 40),
                48 => {
                    i += self.parseExtendedColor(i, &self.current_bg);
                },
                49 => self.current_bg = cell_mod.DEFAULT_COLOR,
                90...97 => self.current_fg = @intCast(p - 90 + 8),
                100...107 => self.current_bg = @intCast(p - 100 + 8),
                else => {
                    // Skip colon sub-parameters we don't handle
                    while (i + 1 < self.parser.param_count and self.parser.subparam[i + 1]) {
                        i += 1;
                    }
                },
            }
            i += 1;
        }
    }

    /// Parses 38;5;n (256-color) and 38;2;r;g;b (24-bit color)
    fn parseExtendedColor(self: *const Terminal, start: u8, color: *u16) u8 {
        if (start + 1 >= self.parser.param_count) return 0;
        const kind = self.parser.params[start + 1];
        if (kind == 5 and start + 2 < self.parser.param_count) {
            color.* = self.parser.params[start + 2];
            return 2;
        }
        if (kind == 2 and start + 4 < self.parser.param_count) {
            const r = self.parser.params[start + 2];
            const g = self.parser.params[start + 3];
            const b_val = self.parser.params[start + 4];
            // Pack RGB into u16: use color indices 257+ for RGB
            // Store as index into a separate RGB table via WASM API
            // For now, find closest 256-color match
            color.* = rgbTo256(@intCast(r), @intCast(g), @intCast(b_val));
            return 4;
        }
        return 0;
    }

    fn resetStyle(self: *Terminal) void {
        self.current_fg = cell_mod.DEFAULT_COLOR;
        self.current_bg = cell_mod.DEFAULT_COLOR;
        self.current_flags = 0;
    }

    // -- OSC --

    fn handleOsc(self: *Terminal) void {
        if (self.parser.osc_len < 2) return;
        const data = self.parser.osc_data[0..self.parser.osc_len];

        // OSC 0;title ST  or  OSC 2;title ST
        if ((data[0] == '0' or data[0] == '2') and data[1] == ';') {
            const title = data[2..];
            const len = if (title.len > self.title_buf.len) self.title_buf.len else title.len;
            var j: u16 = 0;
            while (j < len) : (j += 1) {
                self.title_buf[j] = title[j];
            }
            self.title_len = @intCast(len);
            self.title_changed = true;
        }
    }

    // -- Tab stops --

    fn initTabStops() [grid_mod.MAX_COLS]u8 {
        var stops = [_]u8{0} ** grid_mod.MAX_COLS;
        var i: u16 = 8;
        while (i < grid_mod.MAX_COLS) : (i += 8) {
            stops[i] = 1;
        }
        return stops;
    }
};

fn appendU16(buf: []u8, start: u8, val: u16) u8 {
    var v = val;
    var tmp: [5]u8 = undefined;
    var count: u8 = 0;
    if (v == 0) {
        buf[start] = '0';
        return start + 1;
    }
    while (v > 0) : (count += 1) {
        tmp[count] = @intCast(v % 10 + '0');
        v /= 10;
    }
    var pos = start;
    var i = count;
    while (i > 0) {
        i -= 1;
        buf[pos] = tmp[i];
        pos += 1;
    }
    return pos;
}

fn rgbTo256(r: u8, g: u8, b: u8) u16 {
    // Check grayscale ramp first
    if (r == g and g == b) {
        if (r < 8) return 16;
        if (r > 248) return 231;
        const idx = @min(23, (@as(u32, r) - 8) / 10);
        return @as(u16, @intCast(idx)) + 232;
    }
    // Map to 6x6x6 color cube (indices 16-231)
    const ri: u16 = @intCast((@as(u32, r) * 5 + 127) / 255);
    const gi: u16 = @intCast((@as(u32, g) * 5 + 127) / 255);
    const bi: u16 = @intCast((@as(u32, b) * 5 + 127) / 255);
    return 16 + ri * 36 + gi * 6 + bi;
}

test "basic print" {
    var t = Terminal.init(80, 24);
    t.write("Hello");
    const h = t.grid.getCell(0, 0);
    const e = t.grid.getCell(0, 1);
    try @import("std").testing.expectEqual(@as(u32, 'H'), h.char);
    try @import("std").testing.expectEqual(@as(u32, 'e'), e.char);
    try @import("std").testing.expectEqual(@as(u16, 5), t.cursor_col);
}

test "linefeed and carriage return" {
    var t = Terminal.init(80, 24);
    t.write("AB\r\nCD");
    try @import("std").testing.expectEqual(@as(u32, 'A'), t.grid.getCell(0, 0).char);
    try @import("std").testing.expectEqual(@as(u32, 'C'), t.grid.getCell(1, 0).char);
    try @import("std").testing.expectEqual(@as(u16, 1), t.cursor_row);
    try @import("std").testing.expectEqual(@as(u16, 2), t.cursor_col);
}

test "cursor movement CSI" {
    var t = Terminal.init(80, 24);
    t.write("\x1b[5;10H");
    try @import("std").testing.expectEqual(@as(u16, 4), t.cursor_row);
    try @import("std").testing.expectEqual(@as(u16, 9), t.cursor_col);
}

test "SGR colors" {
    var t = Terminal.init(80, 24);
    t.write("\x1b[31mR\x1b[0mN");
    const r_cell = t.grid.getCell(0, 0);
    const n_cell = t.grid.getCell(0, 1);
    try @import("std").testing.expectEqual(@as(u16, 1), r_cell.fg);
    try @import("std").testing.expectEqual(cell_mod.DEFAULT_COLOR, n_cell.fg);
}

test "erase in display" {
    var t = Terminal.init(80, 24);
    t.write("ABCDE\x1b[1;3H\x1b[J");
    try @import("std").testing.expectEqual(@as(u32, 'A'), t.grid.getCell(0, 0).char);
    try @import("std").testing.expectEqual(@as(u32, 'B'), t.grid.getCell(0, 1).char);
    try @import("std").testing.expectEqual(@as(u32, ' '), t.grid.getCell(0, 2).char);
}

test "scroll on linefeed at bottom" {
    var t = Terminal.init(80, 3);
    t.write("L1\r\nL2\r\nL3\r\nL4");
    try @import("std").testing.expectEqual(@as(u32, 'L'), t.grid.getCell(0, 0).char);
    try @import("std").testing.expectEqual(@as(u32, '2'), t.grid.getCell(0, 1).char);
}

test "wrap pending" {
    var t = Terminal.init(5, 3);
    t.write("12345");
    try @import("std").testing.expectEqual(true, t.wrap_pending);
    try @import("std").testing.expectEqual(@as(u16, 0), t.cursor_row);
    t.write("6");
    try @import("std").testing.expectEqual(@as(u16, 1), t.cursor_row);
    try @import("std").testing.expectEqual(@as(u16, 1), t.cursor_col);
}

test "alternate screen buffer" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    var ag = Grid.init(80, 24);
    t.alt_grid = &ag;
    t.write("main screen");
    try testing.expectEqual(@as(u32, 'm'), t.grid.getCell(0, 0).char);
    t.write("\x1b[?1049h");
    try testing.expect(t.using_alt_screen);
    try testing.expectEqual(@as(u32, ' '), t.grid.getCell(0, 0).char);
    t.write("alt screen");
    t.write("\x1b[?1049l");
    try testing.expect(!t.using_alt_screen);
    try testing.expectEqual(@as(u32, 'm'), t.grid.getCell(0, 0).char);
}

test "erase inherits current background color" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    // Set bg to red (index 1) and write some text
    t.write("\x1b[41m");
    try testing.expectEqual(@as(u16, 1), t.current_bg);
    // Erase the line — erased cells should inherit the red bg
    t.write("\x1b[2K");
    const cell = t.grid.getCell(0, 0);
    try testing.expectEqual(@as(u16, 1), cell.bg);
    try testing.expectEqual(@as(u32, ' '), cell.char);
    // Erase in display (mode 2) — all cells should have red bg
    t.write("\x1b[2J");
    const cell2 = t.grid.getCell(5, 10);
    try testing.expectEqual(@as(u16, 1), cell2.bg);
    // After SGR reset, erase should use default bg
    t.write("\x1b[0m\x1b[2K");
    const cell3 = t.grid.getCell(0, 0);
    try testing.expectEqual(cell_mod.DEFAULT_COLOR, cell3.bg);
}

test "scroll fills new lines with current background" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 3);
    t.write("\x1b[42m"); // green bg
    t.write("L1\r\nL2\r\nL3\r\nL4");
    // After scrolling, the bottom row's empty cells should have green bg
    const blank_cell = t.grid.getCell(2, 79);
    try testing.expectEqual(@as(u16, 2), blank_cell.bg);
}

test "scrollback" {
    const testing = @import("std").testing;
    const sb = try testing.allocator.create(Scrollback);
    defer testing.allocator.destroy(sb);
    sb.* = .{};
    var t = Terminal.init(80, 3);
    t.scrollback = sb;
    t.write("L1\r\nL2\r\nL3\r\nL4\r\nL5");
    try testing.expectEqual(@as(u32, 2), sb.count);
    const line0 = sb.getLine(0).?;
    try testing.expectEqual(@as(u32, 'L'), line0.cells[0].char);
    try testing.expectEqual(@as(u32, '2'), line0.cells[1].char);
}
