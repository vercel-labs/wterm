const std = @import("std");
const cell_mod = @import("cell.zig");
const grid_mod = @import("grid.zig");
const parser_mod = @import("parser.zig");
const scrollback_mod = @import("scrollback.zig");
const hyperlink_mod = @import("hyperlink.zig");
const unicode_width = @import("unicode_width.zig");
const charset_mod = @import("charset.zig");

const Cell = cell_mod.Cell;
const Grid = grid_mod.Grid;
const Parser = parser_mod.Parser;
const Action = parser_mod.Action;
const Scrollback = scrollback_mod.Scrollback;

pub const DEBUG_LOG_MAX: u8 = 32;
pub const RESPONSE_MAX_BYTES: usize = 64;
pub const RESPONSE_QUEUE_MAX: u16 = 2048;

const KittyFlagStack = struct {
    flags: [8]u5 = [_]u5{0} ** 8,
    index: u3 = 0,

    fn current(self: *const KittyFlagStack) u5 {
        return self.flags[self.index];
    }

    fn push(self: *KittyFlagStack, flags: u5) void {
        self.index +%= 1;
        self.flags[self.index] = flags;
    }

    fn pop(self: *KittyFlagStack, count: u16) void {
        if (count >= self.flags.len) {
            self.* = .{};
            return;
        }
        var remaining = count;
        while (remaining > 0) : (remaining -= 1) {
            self.flags[self.index] = 0;
            self.index -%= 1;
        }
    }

    fn set(self: *KittyFlagStack, flags: u5, mode: u16) void {
        switch (mode) {
            1 => self.flags[self.index] = flags,
            2 => self.flags[self.index] |= flags,
            3 => self.flags[self.index] &= ~flags,
            else => {},
        }
    }
};

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

pub const CursorShape = enum(u8) { block, underline, bar };

pub const MouseEncoding = enum(u8) {
    x10 = 0,
    utf8 = 1,
    sgr = 2,
    urxvt = 3,
    sgr_pixels = 4,
};

// DECSET reports keep independent states even when mouse modes share one
// effective tracking mode or wire encoding.
fn privateModeBit(mode: u16) ?u4 {
    return switch (mode) {
        47 => 0,
        1000 => 1,
        1002 => 2,
        1003 => 3,
        1005 => 4,
        1006 => 5,
        1015 => 6,
        1016 => 7,
        1047 => 8,
        1048 => 9,
        1049 => 10,
        else => null,
    };
}

// Mouse modes occupy bits 1–7; soft reset leaves alternate-screen state alone.
const mouse_private_mode_bits: u16 = 0x00fe;

pub const Terminal = struct {
    grid: Grid,
    parser: Parser = .{},
    scrollback: ?*Scrollback = null,
    hyperlinks: hyperlink_mod.Table = .{},

    cols: u16,
    rows: u16,

    cursor_row: u16 = 0,
    cursor_col: u16 = 0,
    cursor_visible: bool = true,
    cursor_shape: CursorShape = .block,
    cursor_blinking: bool = false,
    wrap_pending: bool = false,

    saved_cursor_row: u16 = 0,
    saved_cursor_col: u16 = 0,
    saved_fg: u16 = cell_mod.DEFAULT_COLOR,
    saved_bg: u16 = cell_mod.DEFAULT_COLOR,
    saved_flags: u8 = 0,

    current_fg: u16 = cell_mod.DEFAULT_COLOR,
    current_bg: u16 = cell_mod.DEFAULT_COLOR,
    current_flags: u8 = 0,
    current_link: u16 = 0,

    charset: charset_mod.State = .{},
    // DECSC character-set snapshots belong to their screen.
    saved_charset: [2]charset_mod.State = [_]charset_mod.State{.{}} ** 2,
    alt_saved_charset: charset_mod.State = .{},

    scroll_top: u16 = 0,
    scroll_bottom: u16 = 0,

    auto_wrap: bool = true,
    origin_mode: bool = false,
    cursor_keys_app: bool = false,
    bracketed_paste: bool = false,
    mouse_tracking: u16 = 0,
    mouse_encoding: MouseEncoding = .x10,
    private_mode_bits: u16 = 0,
    focus_events: bool = false,
    synchronized_output: bool = false,
    synchronized_output_generation: u32 = 0,
    linefeed_mode: bool = false,

    // Alternate screen buffer (pointer to avoid doubling struct size)
    alt_grid: ?*Grid = null,
    alt_saved_cursor_row: u16 = 0,
    alt_saved_cursor_col: u16 = 0,
    alt_saved_cursor_shape: CursorShape = .block,
    alt_saved_fg: u16 = cell_mod.DEFAULT_COLOR,
    alt_saved_bg: u16 = cell_mod.DEFAULT_COLOR,
    alt_saved_flags: u8 = 0,
    alt_saved_link: u16 = 0,
    using_alt_screen: bool = false,
    primary_kitty_keyboard: KittyFlagStack = .{},
    alternate_kitty_keyboard: KittyFlagStack = .{},

    // Title (from OSC 0 / 2)
    title_buf: [256]u8 = undefined,
    title_len: u16 = 0,
    title_changed: bool = false,

    // BEL controls waiting for the host.
    bell_count: u32 = 0,

    // Bounded FIFO for DSR and similar host-to-application replies.
    // When full, new responses are dropped so accepted responses stay ordered.
    response_queue: [RESPONSE_QUEUE_MAX][RESPONSE_MAX_BYTES]u8 = undefined,
    response_lens: [RESPONSE_QUEUE_MAX]u8 = [_]u8{0} ** RESPONSE_QUEUE_MAX,
    response_head: u16 = 0,
    response_tail: u16 = 0,
    response_count: u16 = 0,

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

    fn continuationCell(self: *const Terminal) Cell {
        return Cell{
            .char = 0,
            .fg = self.current_fg,
            .bg = self.current_bg,
            .flags = self.current_flags,
            .width = cell_mod.WIDTH_CONTINUATION,
            .link = self.current_link,
        };
    }

    /// Copy a scrollback line back into the viewport, padded or truncated to the
    /// current width. The line was stored at whatever width was current when it
    /// left, which need not be this one.
    fn setRowFromScrollback(
        self: *Terminal,
        row: u16,
        line: *const scrollback_mod.ScrollbackLine,
        width: u16,
    ) void {
        var c: u16 = 0;
        while (c < width) : (c += 1) {
            self.grid.getRow(row)[c] = if (c < line.len) line.cells[c] else Cell{};
        }
        self.grid.sanitizeWideRowWidth(row, width, Cell{});
        self.grid.dirty[row] = 1;
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
        self.cursor_shape = .block;
        self.cursor_blinking = false;
        self.wrap_pending = false;
        self.saved_cursor_row = 0;
        self.saved_cursor_col = 0;
        self.saved_fg = cell_mod.DEFAULT_COLOR;
        self.saved_bg = cell_mod.DEFAULT_COLOR;
        self.saved_flags = 0;
        self.current_fg = cell_mod.DEFAULT_COLOR;
        self.current_bg = cell_mod.DEFAULT_COLOR;
        self.current_flags = 0;
        self.current_link = 0;
        self.charset = .{};
        self.saved_charset = [_]charset_mod.State{.{}} ** 2;
        self.alt_saved_charset = .{};
        self.scroll_top = 0;
        self.scroll_bottom = rows;
        self.auto_wrap = true;
        self.origin_mode = false;
        self.cursor_keys_app = false;
        self.bracketed_paste = false;
        self.mouse_tracking = 0;
        self.mouse_encoding = .x10;
        self.private_mode_bits = 0;
        self.focus_events = false;
        self.synchronized_output = false;
        self.linefeed_mode = false;
        self.alt_saved_cursor_row = 0;
        self.alt_saved_cursor_col = 0;
        self.alt_saved_cursor_shape = .block;
        self.alt_saved_fg = cell_mod.DEFAULT_COLOR;
        self.alt_saved_bg = cell_mod.DEFAULT_COLOR;
        self.alt_saved_flags = 0;
        self.alt_saved_link = 0;
        self.using_alt_screen = false;
        self.primary_kitty_keyboard = .{};
        self.alternate_kitty_keyboard = .{};
        self.title_len = 0;
        self.title_changed = false;
        self.bell_count = 0;
        self.response_head = 0;
        self.response_tail = 0;
        self.response_count = 0;
        self.tab_stops = initTabStops();
    }

    // -- Public API --

    pub fn write(self: *Terminal, data: []const u8) void {
        for (data) |byte| {
            self.processByte(byte);
        }
    }

    pub fn responsePtr(self: *const Terminal) [*]const u8 {
        return &self.response_queue[self.response_head];
    }

    pub fn responseLen(self: *const Terminal) u8 {
        if (self.response_count == 0) return 0;
        return self.response_lens[self.response_head];
    }

    pub fn popResponse(self: *Terminal) void {
        if (self.response_count == 0) return;
        self.response_lens[self.response_head] = 0;
        self.response_head = (self.response_head + 1) % RESPONSE_QUEUE_MAX;
        self.response_count -= 1;
    }

    fn enqueueResponse(self: *Terminal, response: []const u8) void {
        if (self.response_count == RESPONSE_QUEUE_MAX) return;
        const len = @min(response.len, RESPONSE_MAX_BYTES);
        @memcpy(self.response_queue[self.response_tail][0..len], response[0..len]);
        self.response_lens[self.response_tail] = @intCast(len);
        self.response_tail = (self.response_tail + 1) % RESPONSE_QUEUE_MAX;
        self.response_count += 1;
    }

    pub fn resize(self: *Terminal, new_cols: u16, new_rows: u16) void {
        const cols = if (new_cols > grid_mod.MAX_COLS) grid_mod.MAX_COLS else if (new_cols == 0) 1 else new_cols;
        const rows = if (new_rows > grid_mod.MAX_ROWS) grid_mod.MAX_ROWS else if (new_rows == 0) 1 else new_rows;

        const old_cols = self.cols;
        const old_rows = self.rows;

        if (cols == old_cols and rows == old_rows) return;

        // An allocation failure leaves both the active and inactive screens at
        // their old size. The host can read the applied dimensions afterward.
        self.grid.ensureCapacity(cols, rows) catch return;
        if (self.using_alt_screen) {
            self.alt_grid.?.ensureCapacity(cols, rows) catch return;
        }

        // Clear cells beyond the new column width for each preserved row
        if (cols < old_cols) {
            const preserve_rows = if (rows < old_rows) rows else old_rows;
            var r: u16 = 0;
            while (r < preserve_rows) : (r += 1) {
                var c: u16 = cols;
                while (c < old_cols) : (c += 1) {
                    self.grid.getRow(r)[c] = Cell{};
                }
            }
        }

        // Shrinking vertically drops rows off the top into scrollback, not off
        // the bottom: the viewport is a window onto history, and the window
        // keeps the newest rows. Blank trailing rows below the cursor are
        // discarded first so a shrink that fits does not push live content.
        var restored: u16 = 0;
        if (rows < old_rows) {
            // Scroll only as far as it takes to keep the cursor on screen, so a
            // shrink at a fresh prompt pushes nothing and rows below the cursor
            // are discarded rather than preserved.
            const from_top: u16 = if (self.cursor_row >= rows)
                self.cursor_row - rows + 1
            else
                0;

            if (from_top > 0) {
                if (!self.using_alt_screen and self.scrollback != null) {
                    const push_cols = if (cols < old_cols) cols else old_cols;
                    var r: u16 = 0;
                    while (r < from_top) : (r += 1) {
                        // These rows may have skipped the truncation loop above,
                        // which only covers the rows the grid keeps. Repair at
                        // the width they are stored with, or a pair split by that
                        // width survives in history as a wide cell with no
                        // continuation.
                        self.grid.sanitizeWideRowWidth(r, push_cols, Cell{});
                        self.scrollback.?.push(self.grid.getRow(r), push_cols);
                    }
                }
                self.grid.scrollUp(0, old_rows, from_top, Cell{});
                self.cursor_row = if (self.cursor_row > from_top)
                    self.cursor_row - from_top
                else
                    0;
            }
        }

        self.cols = cols;
        self.rows = rows;
        self.grid.cols = cols;
        self.grid.rows = rows;

        // Growing vertically is the inverse: refill from the top out of history
        // before blanking anything, so shrink then grow is identity on the
        // visible content.
        if (rows > old_rows) {
            const gained = rows - old_rows;
            if (!self.using_alt_screen and self.scrollback != null) {
                const available = self.scrollback.?.count;
                restored = if (gained > available) @intCast(available) else gained;
            }
            if (restored > 0) {
                self.grid.scrollDown(0, old_rows + restored, restored, Cell{});
                var i: u16 = 0;
                while (i < restored) : (i += 1) {
                    // pop returns newest first, so fill the inserted band from
                    // the bottom up to restore chronological order.
                    const line = self.scrollback.?.pop() orelse break;
                    self.setRowFromScrollback(restored - 1 - i, line, cols);
                }
                self.cursor_row += restored;
            }
            var r: u16 = old_rows + restored;
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
                    self.grid.getRow(r2)[c] = Cell{};
                }
                self.grid.dirty[r2] = 1;
            }
        }
        self.scroll_top = 0;
        self.scroll_bottom = rows;

        var sr: u16 = 0;
        while (sr < rows) : (sr += 1) {
            self.grid.sanitizeWideRowWidth(sr, self.cols, Cell{});
        }

        if (self.cursor_col >= cols) self.cursor_col = cols - 1;
        if (self.cursor_row >= rows) self.cursor_row = rows - 1;

        // Mark all rows dirty so the renderer picks up the changes
        var r: u16 = 0;
        while (r < rows) : (r += 1) {
            self.grid.dirty[r] = 1;
        }
        if (self.using_alt_screen) self.alt_grid.?.resizeView(cols, rows);
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
            .unsupported_apc => {},
        }
    }

    // -- Print --

    fn printChar(self: *Terminal, codepoint: u21) void {
        if (self.wrap_pending and self.auto_wrap) {
            self.cursor_col = 0;
            self.doLinefeed();
            self.wrap_pending = false;
        }

        var char = self.charset.map(codepoint);
        var width = unicode_width.displayWidth(char);
        if (width == cell_mod.WIDTH_WIDE and self.cols < 2) {
            // A one-column grid cannot hold a wide pair. Consume a blank
            // cell instead, preserving the usual cursor and wrapping behavior.
            char = ' ';
            width = cell_mod.WIDTH_NARROW;
        }

        if (width == cell_mod.WIDTH_WIDE and self.cursor_col + 1 >= self.cols) {
            if (self.auto_wrap) {
                const blank = self.blankCell();
                self.grid.clearWideCellAt(self.cursor_row, self.cursor_col, blank);
                self.grid.setCell(self.cursor_row, self.cursor_col, blank);
                self.cursor_col = 0;
                self.doLinefeed();
            } else {
                return;
            }
        }

        const blank = self.blankCell();
        self.grid.clearWideCellAt(self.cursor_row, self.cursor_col, blank);
        if (width == cell_mod.WIDTH_WIDE) {
            self.grid.clearWideCellAt(self.cursor_row, self.cursor_col + 1, blank);
        }

        self.grid.setCell(self.cursor_row, self.cursor_col, Cell{
            .char = @intCast(char),
            .fg = self.current_fg,
            .bg = self.current_bg,
            .flags = self.current_flags,
            .width = width,
            .link = self.current_link,
        });

        if (width == cell_mod.WIDTH_WIDE) {
            self.grid.setCell(self.cursor_row, self.cursor_col + 1, self.continuationCell());
        }

        if (self.cursor_col + width < self.cols) {
            self.cursor_col += width;
        } else if (self.auto_wrap) {
            self.cursor_col = self.cols - 1;
            self.wrap_pending = true;
        } else {
            self.cursor_col = self.cols - 1;
        }
    }

    // -- C0 control codes --

    fn executeControl(self: *Terminal, byte: u8) void {
        switch (byte) {
            0x07 => self.bell_count +|= 1, // BEL
            0x08, 0x7F => self.backspace(),
            0x09 => self.horizontalTab(),
            0x0A, 0x0B, 0x0C => {
                self.doLinefeed();
                if (self.linefeed_mode) self.carriageReturn();
            },
            0x0D => self.carriageReturn(),
            0x0E => self.charset.gl = 1, // SO / LS1
            0x0F => self.charset.gl = 0, // SI / LS0
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
                    sb.push(self.grid.getRow(self.scroll_top), self.cols);
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
        if (self.parser.intermediate_count > 0) {
            if (self.parser.intermediate_count != 1) return;
            switch (self.parser.intermediates[0]) {
                '(', ')', '*', '+' => |intermediate| {
                    if (charset_mod.Charset.fromDesignator(byte)) |charset| {
                        self.charset.slots[intermediate - '('] = charset;
                    }
                },
                '#' => if (byte == '8') self.decaln(),
                else => {},
            }
            // An unsupported designation must not dispatch its final byte
            // as a bare ESC command (e.g. ESC ( c must not reset the screen).
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
            'n' => self.charset.gl = 2, // LS2
            'o' => self.charset.gl = 3, // LS3
            'N' => self.charset.single_shift = 2, // SS2
            'O' => self.charset.single_shift = 3, // SS3
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
        self.saved_charset[@intFromBool(self.using_alt_screen)] = self.charset;
    }

    fn restoreCursor(self: *Terminal) void {
        self.cursor_row = self.saved_cursor_row;
        self.cursor_col = self.saved_cursor_col;
        self.current_fg = self.saved_fg;
        self.current_bg = self.saved_bg;
        self.current_flags = self.saved_flags;
        self.charset = self.saved_charset[@intFromBool(self.using_alt_screen)];
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

        // DECSCUSR is CSI Ps SP q; bare CSI q controls keyboard LEDs.
        if (final == 'q' and self.parser.csi_private == 0 and
            self.parser.intermediate_count == 1 and self.parser.intermediates[0] == ' ')
        {
            if (self.parser.param_count <= 1) {
                const style = self.parser.getParam(0, 0);
                if (style <= 6) {
                    self.cursor_shape = switch (style) {
                        3, 4 => .underline,
                        5, 6 => .bar,
                        else => .block,
                    };
                    // Zero restores wterm's default steady block cursor.
                    self.cursor_blinking = style == 1 or style == 3 or style == 5;
                }
            }
            return;
        }

        if (final == 'c') {
            if (self.parser.csi_private == 0 and self.parser.intermediate_count == 0) {
                // VT100 with the advanced video option, matching Ghostty's DA1 reply.
                self.enqueueResponse("\x1b[?1;2c");
            } else {
                self.logUnhandled(final, self.parser.csi_private);
            }
            return;
        }

        if (final == 'u' and switch (self.parser.csi_private) {
            '?', '>', '<', '=' => true,
            else => false,
        }) {
            self.handleKittyKeyboard();
            return;
        }
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

    fn activeKittyKeyboard(self: *Terminal) *KittyFlagStack {
        return if (self.using_alt_screen)
            &self.alternate_kitty_keyboard
        else
            &self.primary_kitty_keyboard;
    }

    pub fn kittyKeyboardFlags(self: *Terminal) u5 {
        return self.activeKittyKeyboard().current();
    }

    fn handleKittyKeyboard(self: *Terminal) void {
        const stack = self.activeKittyKeyboard();
        switch (self.parser.csi_private) {
            '?' => {
                var buf: [RESPONSE_MAX_BYTES]u8 = undefined;
                const response = std.fmt.bufPrint(
                    &buf,
                    "\x1b[?{d}u",
                    .{stack.current()},
                ) catch return;
                self.enqueueResponse(response);
            },
            '>' => {
                const value = if (self.parser.param_count == 1)
                    self.parser.getParam(0, 0)
                else
                    0;
                if (value <= 31) stack.push(@intCast(value));
            },
            '<' => {
                const count = if (self.parser.param_count == 1)
                    self.parser.getParam(0, 1)
                else
                    1;
                stack.pop(count);
            },
            '=' => {
                const value = self.parser.getParam(0, 0);
                const mode = self.parser.getParam(1, 1);
                if (value <= 31 and mode >= 1 and mode <= 3) {
                    stack.set(@intCast(value), mode);
                }
            },
            else => unreachable,
        }
    }

    fn handlePrivateMode(self: *Terminal, final: u8) void {
        if (final == 'p' and self.parser.intermediate_count == 1 and
            self.parser.intermediates[0] == '$')
        {
            if (self.parser.param_count == 1 and !self.parser.subparam[0]) {
                self.reportPrivateMode(self.parser.params[0]);
            }
            return;
        }
        if (self.parser.intermediate_count != 0) {
            self.logUnhandled(final, '?');
            return;
        }
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
            if (privateModeBit(mode)) |bit| {
                const mask = @as(u16, 1) << bit;
                if (enabled) self.private_mode_bits |= mask else self.private_mode_bits &= ~mask;
            }
            switch (mode) {
                1 => self.cursor_keys_app = enabled,
                6 => self.origin_mode = enabled,
                7 => self.auto_wrap = enabled,
                12 => self.cursor_blinking = enabled,
                20 => self.linefeed_mode = enabled,
                25 => self.cursor_visible = enabled,
                47 => self.switchScreen(enabled, false),
                1000 => self.setMouseTracking(1000, enabled),
                1002 => self.setMouseTracking(1002, enabled),
                1003 => self.setMouseTracking(1003, enabled),
                1004 => self.focus_events = enabled,
                1005 => self.mouse_encoding = if (enabled) .utf8 else .x10,
                1006 => self.mouse_encoding = if (enabled) .sgr else .x10,
                1015 => self.mouse_encoding = if (enabled) .urxvt else .x10,
                1016 => self.mouse_encoding = if (enabled) .sgr_pixels else .x10,
                1047 => self.switchScreen(enabled, false),
                1048 => {
                    if (enabled) self.saveCursor() else self.restoreCursor();
                },
                1049 => self.switchScreen(enabled, true),
                2004 => self.bracketed_paste = enabled,
                2026 => {
                    if (enabled and !self.synchronized_output) {
                        self.synchronized_output_generation +%= 1;
                    }
                    self.synchronized_output = enabled;
                },
                else => {},
            }
        }
    }

    fn reportPrivateMode(self: *Terminal, mode: u16) void {
        const active: ?bool = switch (mode) {
            1 => self.cursor_keys_app,
            6 => self.origin_mode,
            7 => self.auto_wrap,
            12 => self.cursor_blinking,
            25 => self.cursor_visible,
            1004 => self.focus_events,
            2004 => self.bracketed_paste,
            2026 => self.synchronized_output,
            else => if (privateModeBit(mode)) |bit|
                self.private_mode_bits & (@as(u16, 1) << bit) != 0
            else
                null,
        };
        const status: u8 = if (active) |enabled| (if (enabled) @as(u8, 1) else 2) else 0;
        var buf: [RESPONSE_MAX_BYTES]u8 = undefined;
        const response = std.fmt.bufPrint(&buf, "\x1b[?{d};{d}$y", .{ mode, status }) catch return;
        self.enqueueResponse(response);
    }

    fn setMouseTracking(self: *Terminal, mode: u16, enabled: bool) void {
        if (enabled) {
            self.mouse_tracking = mode;
        } else if (self.mouse_tracking == mode) {
            self.mouse_tracking = 0;
        }
    }

    fn switchScreen(self: *Terminal, alt: bool, save_cursor: bool) void {
        if (alt == self.using_alt_screen) return;
        const ag = self.alt_grid orelse return;

        if (alt) {
            ag.ensureCapacity(self.cols, self.rows) catch return;
            self.alt_saved_cursor_shape = self.cursor_shape;
            self.alt_saved_link = self.current_link;
            self.current_link = 0;
            if (save_cursor) self.saveCursorToAlt();
            std.mem.swap(Grid, &self.grid, ag);
            self.grid.reset(self.cols, self.rows);
            self.using_alt_screen = true;
        } else {
            std.mem.swap(Grid, &self.grid, ag);
            self.using_alt_screen = false;
            self.current_link = self.alt_saved_link;
            if (save_cursor) {
                self.restoreCursorFromAlt();
                self.cursor_shape = self.alt_saved_cursor_shape;
            }
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
        self.alt_saved_charset = self.charset;
    }

    fn restoreCursorFromAlt(self: *Terminal) void {
        self.cursor_row = @min(self.alt_saved_cursor_row, self.rows - 1);
        self.cursor_col = @min(self.alt_saved_cursor_col, self.cols - 1);
        self.current_fg = self.alt_saved_fg;
        self.current_bg = self.alt_saved_bg;
        self.current_flags = self.alt_saved_flags;
        self.charset = self.alt_saved_charset;
        self.wrap_pending = false;
    }

    fn softReset(self: *Terminal) void {
        self.charset = .{};
        self.saved_charset[@intFromBool(self.using_alt_screen)] = .{};
        self.cursor_visible = true;
        self.origin_mode = false;
        self.auto_wrap = true;
        self.cursor_keys_app = false;
        self.bracketed_paste = false;
        self.mouse_tracking = 0;
        self.mouse_encoding = .x10;
        self.private_mode_bits &= ~mouse_private_mode_bits;
        self.focus_events = false;
        self.synchronized_output = false;
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
            self.enqueueResponse(buf[0..len]);
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
        const count = @min(if (n == 0) 1 else n, self.cols - self.cursor_col);
        const end = self.cursor_col + count;
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
        self.grid.deleteCells(self.cursor_row, self.cursor_col, if (n == 0) 1 else n, self.blankCell());
    }

    fn insertBlanks(self: *Terminal, n: u16) void {
        self.grid.insertCells(self.cursor_row, self.cursor_col, if (n == 0) 1 else n, self.blankCell());
    }

    fn scrollUpN(self: *Terminal, n: u16) void {
        const count = if (n == 0) 1 else n;
        if (!self.using_alt_screen and self.scroll_top == 0) {
            if (self.scrollback) |sb| {
                var i: u16 = 0;
                while (i < count and i < self.scroll_bottom - self.scroll_top) : (i += 1) {
                    sb.push(self.grid.getRow(self.scroll_top + i), self.cols);
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

        if ((data[0] == '0' or data[0] == '2') and data[1] == ';') {
            const title = data[2..];
            const len = if (title.len > self.title_buf.len) self.title_buf.len else title.len;
            var j: u16 = 0;
            while (j < len) : (j += 1) {
                self.title_buf[j] = title[j];
            }
            self.title_len = @intCast(len);
            self.title_changed = true;
            return;
        }

        if (data[0] == '8' and data[1] == ';') {
            if (self.parser.osc_truncated) {
                self.current_link = 0;
                return;
            }
            const params_end = std.mem.indexOfScalarPos(u8, data, 2, ';') orelse {
                self.current_link = 0;
                return;
            };
            const params = data[2..params_end];
            const uri = data[params_end + 1 ..];
            if (uri.len == 0) {
                self.current_link = 0;
                return;
            }

            var explicit_id: ?[]const u8 = null;
            var params_it = std.mem.splitScalar(u8, params, ':');
            while (params_it.next()) |param| {
                if (std.mem.startsWith(u8, param, "id=") and param.len > 3) {
                    explicit_id = param[3..];
                    break;
                }
            }
            self.current_link = self.hyperlinks.open(uri, explicit_id);
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

test "OSC 8 stamps exact cells and closes on BEL or ST" {
    const testing = std.testing;
    var t = Terminal.init(20, 2);
    t.write("\x1b]8;id=docs;https://example.com\x07LINK\x1b]8;;\x1b\\ plain");

    const link = t.grid.getCell(0, 0).link;
    try testing.expect(link != 0);
    try testing.expectEqual(link, t.grid.getCell(0, 3).link);
    try testing.expectEqual(@as(u16, 0), t.grid.getCell(0, 4).link);
    const entry = t.hyperlinks.get(link).?;
    try testing.expectEqualStrings("https://example.com", entry.uri[0..entry.uri_len]);
    try testing.expectEqualStrings("docs", entry.id[0..entry.id_len]);
}

test "OSC 8 overwrite erase and truncation fail closed" {
    const testing = std.testing;
    var t = Terminal.init(20, 2);
    t.write("\x1b]8;;https://example.com\x1b\\LINK\x1b]8;;\x1b\\");
    try testing.expect(t.grid.getCell(0, 0).link != 0);
    t.write("\rX\x1b[K");
    try testing.expectEqual(@as(u16, 0), t.grid.getCell(0, 0).link);
    try testing.expectEqual(@as(u16, 0), t.grid.getCell(0, 1).link);

    t.write("\r\n\x1b]8;;https://old.example\x1b\\");
    try testing.expect(t.current_link != 0);
    t.write("\x1b]8;;");
    var i: usize = 0;
    while (i < parser_mod.MAX_OSC + 1) : (i += 1) t.write("x");
    t.write("\x07Y");
    try testing.expectEqual(@as(u16, 0), t.grid.getCell(1, 0).link);

    t.write("\x1b]8;;https://old.example\x1b\\");
    try testing.expect(t.current_link != 0);
    t.write("\x1b]8;malformed\x07Z");
    try testing.expectEqual(@as(u16, 0), t.grid.getCell(1, 1).link);

    t.write("\x1b[H\x1b]8;;https://active.example\x1b\\LINK");
    t.write("\r\x1b[K");
    try testing.expectEqual(@as(u16, 0), t.grid.getCell(0, 0).link);
    t.write("Q");
    try testing.expect(t.grid.getCell(0, 0).link != 0);
}

test "OSC 8 implicit opens keep distinct identity" {
    const testing = std.testing;
    var t = Terminal.init(20, 2);
    t.write("\x1b]8;;https://example.com\x1b\\A\x1b]8;;\x1b\\");
    t.write("\x1b]8;;https://example.com\x1b\\B\x1b]8;;\x1b\\");
    try testing.expect(t.grid.getCell(0, 0).link != t.grid.getCell(0, 1).link);
}

test "OSC 8 covers wide cells and keeps active link state screen-local" {
    const testing = std.testing;
    var alt = Grid.init(20, 2);
    var t = Terminal.init(20, 2);
    t.alt_grid = &alt;

    t.write("\x1b]8;;https://example.com/wide\x1b\\界");
    const primary_link = t.grid.getCell(0, 0).link;
    try testing.expect(primary_link != 0);
    try testing.expectEqual(primary_link, t.grid.getCell(0, 1).link);

    t.write("\x1b[?1049h\x1b[H");
    try testing.expectEqual(@as(u16, 0), t.grid.getCell(0, 0).link);
    t.write("A");
    try testing.expectEqual(@as(u16, 0), t.grid.getCell(0, 0).link);
    t.write("\x1b]8;;https://example.com/alt\x1b\\B");
    const alt_link = t.grid.getCell(0, 1).link;
    try testing.expect(alt_link != 0);

    t.write("\x1b[?1049l");
    try testing.expectEqual(primary_link, t.grid.getCell(0, 0).link);
    try testing.expectEqual(@as(u32, '界'), t.grid.getCell(0, 0).char);
    t.write("C");
    try testing.expectEqual(primary_link, t.grid.getCell(0, 2).link);
}

test "OSC 8 identities remain stable across RIS" {
    const testing = std.testing;
    var t = Terminal.init(20, 2);
    t.write("\x1b]8;;https://a.example\x1b\\A\x1b]8;;\x1b\\");
    const first_link = t.grid.getCell(0, 0).link;
    try testing.expect(first_link != 0);

    t.write("\x1bc");
    t.write("\x1b]8;;https://b.example\x1b\\B\x1b]8;;\x1b\\");
    const second_link = t.grid.getCell(0, 0).link;
    try testing.expect(second_link != 0);
    try testing.expect(first_link != second_link);
    try testing.expectEqualStrings(
        "https://a.example",
        t.hyperlinks.get(first_link).?.uri[0..t.hyperlinks.get(first_link).?.uri_len],
    );
    try testing.expectEqualStrings(
        "https://b.example",
        t.hyperlinks.get(second_link).?.uri[0..t.hyperlinks.get(second_link).?.uri_len],
    );
}

test "DEC special graphics translates fragmented output with style and links intact" {
    var t = Terminal.init(32, 2);
    const input = "\x1b[1;31;44m\x1b]8;;https://example.com\x07\x1b(0_`abcdefghijklmnopqrstuvwxyz{|}~";
    for (input) |byte| t.write(&.{byte});
    try expectRowCells(&t, 0, "_◆▒␉␌␍␊°±␤␋┘┐┌└┼⎺⎻─⎼⎽├┤┴┬│≤≥π≠£·");
    const link = t.grid.getCell(0, 0).link;
    try std.testing.expect(link != 0);
    for (0..32) |col| {
        const cell = t.grid.getCell(0, @intCast(col));
        try std.testing.expectEqual(@as(u8, 1), cell.width);
        try std.testing.expectEqual(@as(u16, 1), cell.fg);
        try std.testing.expectEqual(@as(u16, 4), cell.bg);
        try std.testing.expectEqual(cell_mod.FLAG_BOLD, cell.flags);
        try std.testing.expectEqual(link, cell.link);
    }
    t.write("\x1b(B\r\nqxa");
    try std.testing.expectEqual(@as(u32, 'q'), t.grid.getCell(1, 0).char);
    try std.testing.expectEqual(@as(u32, 'x'), t.grid.getCell(1, 1).char);
    try std.testing.expectEqual(@as(u32, 'a'), t.grid.getCell(1, 2).char);
}

test "G0 and G1 designation and locking shifts leave the cursor and existing cells alone" {
    var t = Terminal.init(8, 2);
    t.write("q");
    t.grid.clearDirty();
    t.write("\x1b)0\x0e");
    try std.testing.expectEqual(@as(u16, 1), t.cursor_col);
    try std.testing.expectEqual(@as(u8, 0), t.grid.dirty[0]);
    try std.testing.expectEqual(@as(u32, 'q'), t.grid.getCell(0, 0).char);
    t.write("qx\x0fq\x1b(0q\x1b(Bq");
    try expectRowCells(&t, 0, "q─│q─q  ");
}

test "G2 and G3 support single and locking shifts and the British set" {
    var t = Terminal.init(12, 2);
    t.write("\x1b*0\x1b+Aq\x1bNqq\x1bO##\x1bnq\x1bo#\x0f#");
    try expectRowCells(&t, 0, "q─q£#─£#    ");
    t.write("\r\n\x1bN\rqq");
    try expectRowCells(&t, 1, "─q          ");
    t.write("\r\x1bN qq");
    try expectRowCells(&t, 1, " qq         ");
}

test "character set translation preserves UTF-8 and wide-cell pairing" {
    var t = Terminal.init(8, 2);
    const input = "\x1b(0é界🙂q";
    for (input) |byte| t.write(&.{byte});
    try expectRowCells(&t, 0, "é界\x00🙂\x00─  ");
    try std.testing.expectEqual(@as(u16, 6), t.cursor_col);
    t.write("\x1b(B\r\n\x1b*0\x1bN界q");
    try expectRowCells(&t, 1, "界\x00q     ");
}

test "cursor saves restore all character set designations and pending single shifts" {
    var t = Terminal.init(8, 2);
    t.write("\x1b)0\x0e\x1b7\x1b)B\x0f\x1b8q");
    try expectRowCells(&t, 0, "─       ");
    t.write("\x0f\x1b*0\x1bN\x1b[sq\x1b*B\x1b[uqq");
    try expectRowCells(&t, 0, "──q     ");
}

test "alternate screen cursor restoration preserves primary character sets" {
    var alt = Grid.init(8, 2);
    var t = Terminal.init(8, 2);
    t.alt_grid = &alt;
    t.write("\x1b(0\x1b7\x1b[?1049hq");
    try expectRowCells(&t, 0, "─       ");
    t.write("\x1b(B\x1b[H\x1b7q\x1b[?1049lq");
    try expectRowCells(&t, 0, "─       ");
    // Saving an alternate-screen charset must not overwrite primary DECSC.
    t.write("\x1b(B\x1b8q");
    try expectRowCells(&t, 0, "─       ");
    t.write("\x1b[?47h\x1b(B\x1b[?47lq");
    try expectRowCells(&t, 0, "─q      ");
}

test "hard and soft resets clear character set designations and saved shifts" {
    for ([_][]const u8{ "\x1bc", "\x1b[!p" }) |reset_sequence| {
        var t = Terminal.init(8, 2);
        t.write("\x1b(0\x1b)0\x1b*0\x1b+0\x0e\x1bN\x1b7");
        t.write(reset_sequence);
        t.write("q\x0eq\x1bnq\x1boq\x1bNq\x1bOq");
        try expectRowCells(&t, 0, "qqqqqq  ");
        t.write("\x1b8q");
        try std.testing.expectEqual(@as(u32, 'q'), t.grid.getCell(0, 0).char);
    }
}

test "unsupported and cancelled designations do not execute bare ESC commands" {
    var t = Terminal.init(8, 2);
    t.write("AB\x1b7CD\x1b(0\x1b(c\x1b(D\x1b(8\x1b(7\x1b( M\x1b((Bq");
    try expectRowCells(&t, 0, "ABCD─   ");
    try std.testing.expectEqual(@as(u16, 0), t.cursor_row);
    try std.testing.expectEqual(@as(u16, 5), t.cursor_col);
    t.write("\x1b(\x18q\x1b(\x1b(Bq");
    try expectRowCells(&t, 0, "ABCD──q ");
    t.write("\x1b8q");
    try expectRowCells(&t, 0, "ABqD──q ");
}

test "wide characters advance by two cells" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\xF0\x9F\x93\x81");
    try testing.expectEqual(@as(u16, 2), t.cursor_col);
    try testing.expectEqual(cell_mod.WIDTH_WIDE, t.grid.getCell(0, 0).width);
    try testing.expectEqual(cell_mod.WIDTH_CONTINUATION, t.grid.getCell(0, 1).width);

    t.write("abcd");
    t.write("\x1b[1;4Hx");
    try testing.expectEqual(@as(u32, 0x1F4C1), t.grid.getCell(0, 0).char);
    try testing.expectEqual(@as(u32, 'a'), t.grid.getCell(0, 2).char);
    try testing.expectEqual(@as(u32, 'x'), t.grid.getCell(0, 3).char);
    try testing.expectEqual(@as(u32, 'c'), t.grid.getCell(0, 4).char);
    try testing.expectEqual(@as(u32, 'd'), t.grid.getCell(0, 5).char);
}

test "CJK and fullwidth characters advance by two cells" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\xE4\xB8\xAD");
    try testing.expectEqual(@as(u16, 2), t.cursor_col);
    try testing.expectEqual(cell_mod.WIDTH_WIDE, t.grid.getCell(0, 0).width);
    try testing.expectEqual(cell_mod.WIDTH_CONTINUATION, t.grid.getCell(0, 1).width);

    t.write("\xEF\xBC\xA1");
    try testing.expectEqual(@as(u16, 4), t.cursor_col);
    try testing.expectEqual(cell_mod.WIDTH_WIDE, t.grid.getCell(0, 2).width);
    try testing.expectEqual(cell_mod.WIDTH_CONTINUATION, t.grid.getCell(0, 3).width);
}

test "printing over wide character clears both cells" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\xF0\x9F\x93\x81ab");
    t.write("\x1b[1;2Hx");
    try testing.expectEqual(@as(u32, ' '), t.grid.getCell(0, 0).char);
    try testing.expectEqual(cell_mod.WIDTH_NARROW, t.grid.getCell(0, 0).width);
    try testing.expectEqual(@as(u32, 'x'), t.grid.getCell(0, 1).char);
    try testing.expectEqual(cell_mod.WIDTH_NARROW, t.grid.getCell(0, 1).width);
    try testing.expectEqual(@as(u32, 'a'), t.grid.getCell(0, 2).char);
}

fn expectRowCells(t: *const Terminal, row: u16, expected: []const u8) !void {
    var chars = (try std.unicode.Utf8View.init(expected)).iterator();
    var col: u16 = 0;
    while (chars.nextCodepoint()) |char| : (col += 1) {
        const cell = t.grid.getCell(row, col);
        try std.testing.expectEqual(@as(u32, char), cell.char);
        try std.testing.expectEqual(if (char == 0) cell_mod.WIDTH_CONTINUATION else unicode_width.displayWidth(char), cell.width);
    }
    try std.testing.expectEqual(t.cols, col);
}

test "character edits shift exact columns across wide pairs" {
    const cases = [_]struct { input: []const u8, col: u16, edit: []const u8, expected: []const u8 }{
        .{ .input = "A界BC", .col = 1, .edit = "\x1b[P", .expected = "A BC    " },
        .{ .input = "A界BC", .col = 2, .edit = "\x1b[P", .expected = "A BC    " },
        .{ .input = "A界BC", .col = 1, .edit = "\x1b[2P", .expected = "ABC     " },
        .{ .input = "A界語BC", .col = 2, .edit = "\x1b[2P", .expected = "A  BC   " },
        .{ .input = "A界語BC", .col = 2, .edit = "\x1b[P", .expected = "A 語\x00BC  " },
        .{ .input = "A界語BC", .col = 0, .edit = "\x1b[P", .expected = "界\x00語\x00BC  " },
        .{ .input = "A界BC", .col = 2, .edit = "\x1b[0P", .expected = "A BC    " },
        .{ .input = "ABCDEF界", .col = 7, .edit = "\x1b[P", .expected = "ABCDEF  " },
        .{ .input = "A界BC", .col = 2, .edit = "\x1b[65535P", .expected = "A       " },
        .{ .input = "A界BC", .col = 1, .edit = "\x1b[@", .expected = "A 界\x00BC  " },
        .{ .input = "A界BC", .col = 2, .edit = "\x1b[@", .expected = "A   BC  " },
        .{ .input = "A界語BC", .col = 2, .edit = "\x1b[@", .expected = "A   語\x00BC" },
        .{ .input = "A界BC", .col = 2, .edit = "\x1b[0@", .expected = "A   BC  " },
        .{ .input = "ABCDE界F", .col = 1, .edit = "\x1b[@", .expected = "A BCDE界\x00" },
        .{ .input = "ABCDE界F", .col = 1, .edit = "\x1b[2@", .expected = "A  BCDE " },
        .{ .input = "ABCDEF界", .col = 7, .edit = "\x1b[@", .expected = "ABCDEF  " },
        .{ .input = "A界BC", .col = 2, .edit = "\x1b[65535@", .expected = "A       " },
        .{ .input = "A界BC", .col = 0, .edit = "\x1b[65535@", .expected = "        " },
        .{ .input = "A界BC", .col = 2, .edit = "\x1b[65535X", .expected = "A       " },
    };
    for (cases) |case| {
        var t = Terminal.init(8, 2);
        t.write(case.input);
        t.cursorPosition(1, case.col + 1);
        t.grid.clearDirty();
        t.write(case.edit);
        try expectRowCells(&t, 0, case.expected);
        try expectRowCells(&t, 1, "        ");
        try std.testing.expectEqual(case.col, t.cursor_col);
        try std.testing.expectEqual(@as(u16, 0), t.cursor_row);
        try std.testing.expectEqual(@as(u8, 1), t.grid.dirty[0]);
        try std.testing.expectEqual(@as(u8, 0), t.grid.dirty[1]);
    }
}

test "wide edit repairs use erase background and preserve shifted attributes and links" {
    for ([_][]const u8{ "\x1b[P", "\x1b[@" }) |edit| {
        var t = Terminal.init(8, 2);
        t.write("\x1b[1;31;44m\x1b]8;;https://example.com\x07A界語B");
        const lead = t.grid.getCell(0, 3);
        const continuation = t.grid.getCell(0, 4);
        const following = t.grid.getCell(0, 5);
        t.write("\x1b[42m\x1b[1;3H");
        t.write(edit);
        const insert = edit[2] == '@';
        const shifted: u16 = if (insert) 4 else 2;
        try std.testing.expectEqualDeep(lead, t.grid.getCell(0, shifted));
        try std.testing.expectEqualDeep(continuation, t.grid.getCell(0, shifted + 1));
        try std.testing.expectEqualDeep(following, t.grid.getCell(0, shifted + 2));
        try std.testing.expectEqualDeep(Cell{ .bg = 2 }, t.grid.getCell(0, 1));
        if (insert) {
            try std.testing.expectEqualDeep(Cell{ .bg = 2 }, t.grid.getCell(0, 2));
            try std.testing.expectEqualDeep(Cell{ .bg = 2 }, t.grid.getCell(0, 3));
        } else {
            try std.testing.expectEqualDeep(Cell{ .bg = 2 }, t.grid.getCell(0, 7));
        }
    }
}

test "insert blanks shifts wide cells without splitting them" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("ab\xF0\x9F\x93\x81");
    t.write("\x1b[1;3H\x1b[@");
    try testing.expectEqual(@as(u32, 'a'), t.grid.getCell(0, 0).char);
    try testing.expectEqual(@as(u32, 'b'), t.grid.getCell(0, 1).char);
    try testing.expectEqual(@as(u32, ' '), t.grid.getCell(0, 2).char);
    try testing.expectEqual(@as(u32, 0x1F4C1), t.grid.getCell(0, 3).char);
    try testing.expectEqual(cell_mod.WIDTH_WIDE, t.grid.getCell(0, 3).width);
    try testing.expectEqual(cell_mod.WIDTH_CONTINUATION, t.grid.getCell(0, 4).width);
}

test "wide character wraps before final column" {
    const testing = @import("std").testing;
    var t = Terminal.init(5, 2);
    t.write("1234");
    t.write("\xF0\x9F\x93\x81");
    try testing.expectEqual(@as(u32, ' '), t.grid.getCell(0, 4).char);
    try testing.expectEqual(@as(u32, 0x1F4C1), t.grid.getCell(1, 0).char);
    try testing.expectEqual(cell_mod.WIDTH_CONTINUATION, t.grid.getCell(1, 1).width);
    try testing.expectEqual(@as(u16, 1), t.cursor_row);
    try testing.expectEqual(@as(u16, 2), t.cursor_col);
}

test "wide characters that cannot fit with wrapping disabled leave the grid untouched" {
    for ([_][]const u8{ "abcd", "abcde", "abc界" }) |input| {
        var t = Terminal.init(5, 2);
        t.write(input);
        const before: [5]Cell = t.grid.getRow(0)[0..5].*;
        t.grid.clearDirty();
        t.write("\x1b[?7l界");
        try std.testing.expectEqualDeep(before, t.grid.getRow(0)[0..5].*);
        try std.testing.expectEqual(@as(u8, 0), t.grid.dirty[0]);
        try std.testing.expectEqual(@as(u8, 0), t.grid.dirty[1]);
        try std.testing.expectEqual(@as(u16, 0), t.cursor_row);
        try std.testing.expectEqual(@as(u16, 4), t.cursor_col);
    }
}

test "disabling wrapping suspends a pending wrap" {
    var t = Terminal.init(5, 2);
    t.write("abcde\x1b[?7l界X");
    try expectRowCells(&t, 0, "abcdX");
    try std.testing.expectEqual(@as(u16, 0), t.cursor_row);
    t.write("\x1b[?7hY");
    try expectRowCells(&t, 1, "Y    ");
    try std.testing.expectEqual(@as(u16, 1), t.cursor_row);
    try std.testing.expectEqual(@as(u16, 1), t.cursor_col);
}

test "single-column grids consume wide characters as spaces" {
    for ([_]bool{ true, false }) |wrap| {
        var t = Terminal.init(1, 2);
        if (!wrap) t.write("\x1b[?7l");
        t.write("a\r界");
        try expectRowCells(&t, 0, " ");
        try std.testing.expectEqual(wrap, t.wrap_pending);
        t.write("B");
        try expectRowCells(&t, if (wrap) 1 else 0, "B");
        try std.testing.expectEqual(@as(u16, if (wrap) 1 else 0), t.cursor_row);
        try std.testing.expectEqual(@as(u16, 0), t.cursor_col);
    }
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

test "queues consecutive CPR responses in order" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\x1b[1G\x1b[6n\x1b[2G\x1b[6n");

    try testing.expectEqualStrings("\x1b[1;1R", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();
    try testing.expectEqualStrings("\x1b[1;2R", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();
    try testing.expectEqual(@as(u8, 0), t.responseLen());
}

test "answers primary device attributes without claiming other variants" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);

    t.write("\x1b[c\x1b[6n\x1b[0c\x1b[2c\x1b[0;0c");
    for ([_][]const u8{
        "\x1b[?1;2c",
        "\x1b[1;1R",
        "\x1b[?1;2c",
        "\x1b[?1;2c",
        "\x1b[?1;2c",
    }) |expected| {
        try testing.expectEqualStrings(expected, t.responsePtr()[0..t.responseLen()]);
        t.popResponse();
    }

    t.write("\x1b[?c\x1b[>c\x1b[!c\x1b[=c\x1b[ c");
    try testing.expectEqual(@as(u8, 0), t.responseLen());
}

test "reports DEC private modes and ignores malformed queries" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    var ag = Grid.init(80, 24);
    t.alt_grid = &ag;

    t.write("\x1b[?7$p\x1b[?25$p\x1b[?2026$p\x1b[?7777$p");
    for ([_][]const u8{
        "\x1b[?7;1$y",
        "\x1b[?25;1$y",
        "\x1b[?2026;2$y",
        "\x1b[?7777;0$y",
    }) |expected| {
        try testing.expectEqualStrings(expected, t.responsePtr()[0..t.responseLen()]);
        t.popResponse();
    }

    t.write("\x1b[?2026h\x1b[?2026$");
    t.write("p\x1b[?2004h\x1b[?2004$p");
    try testing.expectEqualStrings("\x1b[?2026;1$y", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();
    try testing.expectEqualStrings("\x1b[?2004;1$y", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();
    try testing.expect(t.synchronized_output);
    try testing.expectEqual(@as(u32, 1), t.synchronized_output_generation);

    t.write("\x1b[?2026l\x1b[?2026$p\x1b[?2004l\x1b[?2004$p");
    try testing.expectEqualStrings("\x1b[?2026;2$y", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();
    try testing.expectEqualStrings("\x1b[?2004;2$y", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();

    t.write("\x1b[?2026p\x1b[2026$p\x1b[?25;2026$p");
    try testing.expectEqual(@as(u8, 0), t.responseLen());
}

test "reports independently enabled mouse and alternate-screen modes" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    var ag = Grid.init(80, 24);
    t.alt_grid = &ag;

    t.write("\x1b[?1000h\x1b[?1002h\x1b[?1005h\x1b[?1006h");
    t.write("\x1b[?1000$p\x1b[?1002$p\x1b[?1005$p\x1b[?1006$p");
    for ([_][]const u8{
        "\x1b[?1000;1$y",
        "\x1b[?1002;1$y",
        "\x1b[?1005;1$y",
        "\x1b[?1006;1$y",
    }) |expected| {
        try testing.expectEqualStrings(expected, t.responsePtr()[0..t.responseLen()]);
        t.popResponse();
    }

    t.write("\x1b[?1002l\x1b[?1006l\x1b[?1000$p\x1b[?1002$p\x1b[?1005$p\x1b[?1006$p");
    for ([_][]const u8{
        "\x1b[?1000;1$y",
        "\x1b[?1002;2$y",
        "\x1b[?1005;1$y",
        "\x1b[?1006;2$y",
    }) |expected| {
        try testing.expectEqualStrings(expected, t.responsePtr()[0..t.responseLen()]);
        t.popResponse();
    }

    t.write("\x1b[?1016h\x1b[?1016l\x1b[?1005$p\x1b[?1016$p");
    try testing.expectEqualStrings("\x1b[?1005;1$y", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();
    try testing.expectEqualStrings("\x1b[?1016;2$y", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();

    t.write("\x1b[?1049h\x1b[?1048h\x1b[?47$p\x1b[?1048$p\x1b[?1049$p");
    for ([_][]const u8{
        "\x1b[?47;2$y",
        "\x1b[?1048;1$y",
        "\x1b[?1049;1$y",
    }) |expected| {
        try testing.expectEqualStrings(expected, t.responsePtr()[0..t.responseLen()]);
        t.popResponse();
    }

    t.write("\x1b[?1049l\x1b[!p\x1b[?1000$p\x1b[?1005$p\x1b[?1049$p");
    for ([_][]const u8{
        "\x1b[?1000;2$y",
        "\x1b[?1005;2$y",
        "\x1b[?1049;2$y",
    }) |expected| {
        try testing.expectEqualStrings(expected, t.responsePtr()[0..t.responseLen()]);
        t.popResponse();
    }
}

test "response FIFO wraps and drops newest when full" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    var index: u16 = 0;
    while (index < RESPONSE_QUEUE_MAX) : (index += 1) t.write("\x1b[6n");
    try testing.expectEqual(RESPONSE_QUEUE_MAX, t.response_count);
    t.write("\x1b[2G\x1b[6n");
    try testing.expectEqual(RESPONSE_QUEUE_MAX, t.response_count);

    index = 0;
    while (index < RESPONSE_QUEUE_MAX) : (index += 1) t.popResponse();
    try testing.expectEqual(@as(u8, 0), t.responseLen());
    t.write("\x1b[3G\x1b[6n");
    try testing.expectEqualStrings("\x1b[1;3R", t.responsePtr()[0..t.responseLen()]);
}

test "reset clears queued responses" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\x1b[6n\x1b[6n");
    try testing.expectEqual(@as(u16, 2), t.response_count);
    t.reset(80, 24);
    try testing.expectEqual(@as(u8, 0), t.responseLen());
}

test "kitty keyboard state transitions and query" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\x1b[?u");
    try testing.expectEqualStrings("\x1b[?0u", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();
    t.write("\x1b[>5u\x1b[=2;2u\x1b[=1;3u\x1b[?u");
    try testing.expectEqual(@as(u5, 6), t.kittyKeyboardFlags());
    try testing.expectEqualStrings("\x1b[?6u", t.responsePtr()[0..t.responseLen()]);
    t.popResponse();
    t.write("\x1b[<u\x1b[?u");
    try testing.expectEqual(@as(u5, 0), t.kittyKeyboardFlags());
    try testing.expectEqualStrings("\x1b[?0u", t.responsePtr()[0..t.responseLen()]);
}

test "kitty keyboard stack wraps and oversized pop clears" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    var count: u8 = 0;
    while (count < 9) : (count += 1) t.write("\x1b[>1u");
    try testing.expectEqual(@as(u5, 1), t.kittyKeyboardFlags());
    t.write("\x1b[<10u");
    try testing.expectEqual(@as(u5, 0), t.kittyKeyboardFlags());
}

test "kitty keyboard push and pop default extra parameters" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\x1b[>5u\x1b[>7;2u");
    try testing.expectEqual(@as(u5, 0), t.kittyKeyboardFlags());
    t.write("\x1b[<u");
    try testing.expectEqual(@as(u5, 5), t.kittyKeyboardFlags());
    t.write("\x1b[<1;2u");
    try testing.expectEqual(@as(u5, 0), t.kittyKeyboardFlags());
}

test "kitty keyboard state is per screen and follows reset semantics" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    var ag = Grid.init(80, 24);
    t.alt_grid = &ag;
    t.write("\x1b[>6u\x1b[?1049h");
    try testing.expectEqual(@as(u5, 0), t.kittyKeyboardFlags());
    t.write("\x1b[>9u\x1b[!p");
    try testing.expectEqual(@as(u5, 9), t.kittyKeyboardFlags());
    t.write("\x1b[?1049l");
    try testing.expectEqual(@as(u5, 6), t.kittyKeyboardFlags());
    t.write("\x1bc");
    try testing.expectEqual(@as(u5, 0), t.kittyKeyboardFlags());
    try testing.expect(!t.using_alt_screen);
}

test "plain CSI u remains cursor restore" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\x1b[4;5H\x1b[s\x1b[8;9H\x1b[u");
    try testing.expectEqual(@as(u16, 3), t.cursor_row);
    try testing.expectEqual(@as(u16, 4), t.cursor_col);
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

test "tracks mouse and focus modes across reset" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\x1b[?1000h\x1b[?1004h\x1b[?1006h");
    try testing.expectEqual(@as(u16, 1000), t.mouse_tracking);
    try testing.expectEqual(MouseEncoding.sgr, t.mouse_encoding);
    try testing.expect(t.focus_events);
    t.write("\x1b[?1002h\x1b[?1000l");
    try testing.expectEqual(@as(u16, 1002), t.mouse_tracking);
    t.write("\x1b[?1003h\x1b[?1002l");
    try testing.expectEqual(@as(u16, 1003), t.mouse_tracking);
    t.write("\x1b[?1003l");
    try testing.expectEqual(@as(u16, 0), t.mouse_tracking);
    t.write("\x1b[?1003h");
    t.write("\x1b[!p");
    try testing.expectEqual(@as(u16, 0), t.mouse_tracking);
    try testing.expectEqual(MouseEncoding.x10, t.mouse_encoding);
    try testing.expect(!t.focus_events);
}

test "tracks mouse wire encoding modes" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    try testing.expectEqual(MouseEncoding.x10, t.mouse_encoding);

    t.write("\x1b[?1005h");
    try testing.expectEqual(MouseEncoding.utf8, t.mouse_encoding);
    t.write("\x1b[?1015h");
    try testing.expectEqual(MouseEncoding.urxvt, t.mouse_encoding);
    t.write("\x1b[?1006h");
    try testing.expectEqual(MouseEncoding.sgr, t.mouse_encoding);
    t.write("\x1b[?1016h");
    try testing.expectEqual(MouseEncoding.sgr_pixels, t.mouse_encoding);

    t.write("\x1b[?1016l");
    try testing.expectEqual(MouseEncoding.x10, t.mouse_encoding);
    t.write("\x1b[?1005h\x1b[!p");
    try testing.expectEqual(MouseEncoding.x10, t.mouse_encoding);
}

test "tracks synchronized output across fragmented writes and reset" {
    const testing = @import("std").testing;
    var t = Terminal.init(80, 24);
    t.write("\x1b[?20");
    t.write("26h");
    try testing.expect(t.synchronized_output);
    t.write("\x1b[?2026l");
    try testing.expect(!t.synchronized_output);
    t.write("\x1b[?2026h\x1b[!p");
    try testing.expect(!t.synchronized_output);
    t.write("\x1b[?2026h");
    t.reset(80, 24);
    try testing.expect(!t.synchronized_output);
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

test "scrollback stays ordered across a vertical shrink (#43)" {
    const testing = std.testing;
    const sb = try testing.allocator.create(Scrollback);
    defer testing.allocator.destroy(sb);
    sb.* = .{};
    var t = Terminal.init(80, 24);
    t.scrollback = sb;

    var buf: [32]u8 = undefined;
    var i: u32 = 1;
    while (i <= 200) : (i += 1) {
        t.write(try std.fmt.bufPrint(&buf, "line {d}\r\n", .{i}));
    }
    t.resize(80, 6);

    // Oldest to newest, every stored line must be the next one written.
    var prev: u32 = 0;
    var off: u32 = sb.count;
    while (off > 0) {
        off -= 1;
        const line = sb.getLine(off).?;
        var text: [32]u8 = undefined;
        var n: usize = 0;
        var c: u16 = 0;
        while (c < line.len and n < text.len) : (c += 1) {
            const ch = line.cells[c].char;
            if (ch >= 32 and ch < 127) {
                text[n] = @intCast(ch);
                n += 1;
            }
        }
        while (n > 0 and text[n - 1] == ' ') n -= 1;
        if (n == 0) continue;
        try testing.expect(std.mem.startsWith(u8, text[0..n], "line "));
        const num = try std.fmt.parseInt(u32, text[5..n], 10);
        if (prev != 0) try testing.expectEqual(prev + 1, num);
        prev = num;
    }
    try testing.expect(prev > 0);
}

test "scrollback reads stay correct after a pop on a wrapped ring" {
    const testing = @import("std").testing;
    const sb = try testing.allocator.create(Scrollback);
    defer testing.allocator.destroy(sb);
    sb.* = .{};

    // Fill past capacity so the ring wraps, then take one back out. `count`
    // now drops below the maximum while `write_pos` sits mid-ring, so any read
    // that treats "count < max" as "never wrapped" lands on the wrong line.
    var row: [grid_mod.MAX_COLS]Cell = undefined;
    var i: u32 = 0;
    while (i < scrollback_mod.MAX_SCROLLBACK_LINES + 10) : (i += 1) {
        row[0] = Cell{ .char = 'a' + @as(u32, @intCast(i % 26)) };
        sb.push(&row, 1);
    }
    const newest = sb.getLine(0).?.cells[0].char;
    const second = sb.getLine(1).?.cells[0].char;

    _ = sb.pop();
    try testing.expectEqual(second, sb.getLine(0).?.cells[0].char);
    try testing.expect(sb.getLine(0).?.cells[0].char != newest);
}

test "vertical shrink then grow restores the viewport" {
    const testing = @import("std").testing;
    const sb = try testing.allocator.create(Scrollback);
    defer testing.allocator.destroy(sb);
    sb.* = .{};
    var t = Terminal.init(20, 6);
    t.scrollback = sb;
    t.write("r0\r\nr1\r\nr2\r\nr3\r\nr4\r\nr5");

    var before: [6][2]u32 = undefined;
    for (0..6) |r| {
        before[r][0] = t.grid.getCell(@intCast(r), 0).char;
        before[r][1] = t.grid.getCell(@intCast(r), 1).char;
    }
    const scrollback_before = sb.count;

    t.resize(20, 3);
    // The window keeps the newest rows, so the bottom of the screen is unchanged.
    try testing.expectEqual(@as(u32, 'r'), t.grid.getCell(2, 0).char);
    try testing.expectEqual(@as(u32, '5'), t.grid.getCell(2, 1).char);
    try testing.expectEqual(scrollback_before + 3, sb.count);

    t.resize(20, 6);
    for (0..6) |r| {
        try testing.expectEqual(before[r][0], t.grid.getCell(@intCast(r), 0).char);
        try testing.expectEqual(before[r][1], t.grid.getCell(@intCast(r), 1).char);
    }
    try testing.expectEqual(scrollback_before, sb.count);
}

test "shrink at a top-of-screen prompt adds no scrollback" {
    const testing = @import("std").testing;
    const sb = try testing.allocator.create(Scrollback);
    defer testing.allocator.destroy(sb);
    sb.* = .{};
    var t = Terminal.init(80, 24);
    t.scrollback = sb;
    t.write("$ ");
    try testing.expectEqual(@as(u16, 0), t.cursor_row);
    t.resize(80, 8);
    try testing.expectEqual(@as(u32, 0), sb.count);
    try testing.expectEqual(@as(u16, 0), t.cursor_row);
    try testing.expectEqual(@as(u32, '$'), t.grid.getCell(0, 0).char);
}

test "shrink keeps the cursor row on screen when content sits below it" {
    const testing = @import("std").testing;
    const sb = try testing.allocator.create(Scrollback);
    defer testing.allocator.destroy(sb);
    sb.* = .{};
    var t = Terminal.init(20, 8);
    t.scrollback = sb;
    t.write("r0\r\nr1\r\nr2\r\nr3\r\nr4\r\nr5\r\nr6\r\nr7");
    t.write("\x1b[3;1H");
    try testing.expectEqual(@as(u16, 2), t.cursor_row);
    t.resize(20, 3);
    try testing.expectEqual(@as(u32, '2'), t.grid.getCell(t.cursor_row, 1).char);
}

test "alternate screen resize does not touch scrollback" {
    const testing = @import("std").testing;
    const sb = try testing.allocator.create(Scrollback);
    defer testing.allocator.destroy(sb);
    sb.* = .{};
    var t = Terminal.init(20, 6);
    t.scrollback = sb;
    t.write("\x1b[?1049h");
    t.write("a0\r\na1\r\na2\r\na3\r\na4\r\na5");
    const before = sb.count;
    t.resize(20, 3);
    t.resize(20, 6);
    try testing.expectEqual(before, sb.count);
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

test "grids grow beyond 256 columns and rows without losing cells" {
    const testing = std.testing;
    var t = Terminal.init(80, 24);
    defer t.grid.deinit();
    t.write("A");

    t.resize(320, 300);
    try testing.expectEqual(@as(u16, 320), t.cols);
    try testing.expectEqual(@as(u16, 300), t.rows);
    try testing.expectEqual(@as(u32, 'A'), t.grid.getCell(0, 0).char);
    t.write("\x1b[300;320HZ");
    try testing.expectEqual(@as(u32, 'Z'), t.grid.getCell(299, 319).char);

    t.resize(520, 320);
    try testing.expectEqual(@as(u32, 'Z'), t.grid.getCell(299, 319).char);
    t.grid.clearDirty();
    t.grid.setCell(319, 519, Cell{ .char = 'X' });
    try testing.expectEqual(@as(u8, 1), t.grid.dirty[319]);
    try testing.expectEqual(@as(u32, 'X'), t.grid.getCell(319, 519).char);
}

test "scrollback preserves columns beyond 256" {
    const testing = std.testing;
    const sb = try testing.allocator.create(Scrollback);
    defer testing.allocator.destroy(sb);
    sb.* = .{};
    defer sb.reset();
    var t = Terminal.init(320, 2);
    defer t.grid.deinit();
    t.scrollback = sb;

    t.write("\x1b[1;300HQ\x1b[2;1H\n");
    try testing.expectEqual(@as(u32, 1), sb.count);
    try testing.expectEqual(@as(u16, 320), sb.getLine(0).?.len);
    try testing.expectEqual(@as(u32, 'Q'), sb.getLine(0).?.cells[299].char);

    t.resize(320, 3);
    try testing.expectEqual(@as(u32, 'Q'), t.grid.getCell(0, 299).char);
}

test "alternate screen and hidden primary resize together" {
    const testing = std.testing;
    var t = Terminal.init(320, 3);
    defer t.grid.deinit();
    var alternate = Grid.init(1, 1);
    defer alternate.deinit();
    t.alt_grid = &alternate;

    t.write("\x1b[1;300HP\x1b[?1049h");
    try testing.expect(t.using_alt_screen);
    t.resize(400, 4);
    t.write("\x1b[4;399HA\x1b[?1049l");
    try testing.expect(!t.using_alt_screen);
    try testing.expectEqual(@as(u16, 400), t.grid.cols);
    try testing.expectEqual(@as(u16, 4), t.grid.rows);
    try testing.expectEqual(@as(u32, 'P'), t.grid.getCell(0, 299).char);
    try testing.expectEqual(@as(u32, ' '), t.grid.getCell(3, 398).char);
}

test "alternate screen exit clamps a saved cursor after shrinking" {
    const testing = std.testing;
    var t = Terminal.init(320, 4);
    defer t.grid.deinit();
    var alternate = Grid.init(1, 1);
    defer alternate.deinit();
    t.alt_grid = &alternate;

    t.write("\x1b[4;320H\x1b[?1049h");
    t.resize(80, 2);
    t.write("\x1b[?1049l");
    try testing.expectEqual(@as(u16, 1), t.cursor_row);
    try testing.expectEqual(@as(u16, 79), t.cursor_col);
    t.write("X");
    try testing.expectEqual(@as(u32, 'X'), t.grid.getCell(1, 79).char);
}
