const terminal_mod = @import("terminal.zig");
const grid_mod = @import("grid.zig");
const cell_mod = @import("cell.zig");
const scrollback_mod = @import("scrollback.zig");

const Terminal = terminal_mod.Terminal;

var terminal: Terminal = undefined;
var scrollback: scrollback_mod.Scrollback = .{};
var alt_grid: grid_mod.Grid = undefined;
var input_buffer: [8192]u8 = undefined;
var initialized: bool = false;

// -- Lifecycle --

export fn init(cols: u32, rows: u32) void {
    const c: u16 = if (cols > grid_mod.MAX_COLS) grid_mod.MAX_COLS else if (cols == 0) 1 else @intCast(cols);
    const r: u16 = if (rows > grid_mod.MAX_ROWS) grid_mod.MAX_ROWS else if (rows == 0) 1 else @intCast(rows);
    terminal.reset(c, r);
    terminal.scrollback = &scrollback;
    terminal.alt_grid = &alt_grid;
    scrollback.reset();
    initialized = true;
}

export fn resizeTerminal(cols: u32, rows: u32) void {
    const c: u16 = if (cols > grid_mod.MAX_COLS) grid_mod.MAX_COLS else if (cols == 0) 1 else @intCast(cols);
    const r: u16 = if (rows > grid_mod.MAX_ROWS) grid_mod.MAX_ROWS else if (rows == 0) 1 else @intCast(rows);
    terminal.resize(c, r);
}

// -- Input --

export fn getWriteBuffer() [*]u8 {
    return &input_buffer;
}

export fn writeBytes(len: u32) void {
    const n = if (len > input_buffer.len) input_buffer.len else len;
    terminal.write(input_buffer[0..n]);
}

// -- Grid data --

export fn getGridPtr() [*]const u8 {
    return @ptrCast(&terminal.grid.cells);
}

export fn getDirtyPtr() [*]const u8 {
    return @ptrCast(&terminal.grid.dirty);
}

export fn clearDirty() void {
    terminal.grid.clearDirty();
}

// -- Terminal state --

export fn getCursorRow() u32 {
    return terminal.cursor_row;
}

export fn getCursorCol() u32 {
    return terminal.cursor_col;
}

export fn getCursorVisible() u32 {
    return if (terminal.cursor_visible) 1 else 0;
}

export fn getCols() u32 {
    return terminal.cols;
}

export fn getRows() u32 {
    return terminal.rows;
}

export fn getCursorKeysApp() u32 {
    return if (terminal.cursor_keys_app) 1 else 0;
}

export fn getBracketedPaste() u32 {
    return if (terminal.bracketed_paste) 1 else 0;
}

export fn getUsingAltScreen() u32 {
    return if (terminal.using_alt_screen) 1 else 0;
}

// -- Title --

export fn getTitlePtr() [*]const u8 {
    return &terminal.title_buf;
}

export fn getTitleLen() u32 {
    return terminal.title_len;
}

export fn getTitleChanged() u32 {
    if (terminal.title_changed) {
        terminal.title_changed = false;
        return 1;
    }
    return 0;
}

// -- Scrollback --

export fn getScrollbackCount() u32 {
    return scrollback.count;
}

var scrollback_line_buf: [grid_mod.MAX_COLS * cell_mod.Cell.BYTE_SIZE]u8 = undefined;

export fn getScrollbackLine(offset: u32) [*]const u8 {
    const line = scrollback.getLine(offset);
    if (line) |l| {
        return @ptrCast(&l.cells);
    }
    return &scrollback_line_buf;
}

export fn getScrollbackLineLen(offset: u32) u32 {
    const line = scrollback.getLine(offset);
    if (line) |l| {
        return l.len;
    }
    return 0;
}

// -- Response buffer (for DSR replies) --

export fn getResponsePtr() [*]const u8 {
    return &terminal.response_buf;
}

export fn getResponseLen() u32 {
    return terminal.response_len;
}

export fn clearResponse() void {
    terminal.response_len = 0;
}

// -- Constants --

export fn getCellSize() u32 {
    return cell_mod.Cell.BYTE_SIZE;
}

export fn getMaxCols() u32 {
    return grid_mod.MAX_COLS;
}
