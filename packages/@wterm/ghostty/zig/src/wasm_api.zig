const std = @import("std");
const builtin = @import("builtin");
const vt = @import("ghostty-vt");
const Terminal = vt.Terminal;
const Screen = vt.Screen;
const RenderState = vt.RenderState;
const Style = vt.Style;
const color = vt.color;
const modes = vt.modes;

const Allocator = std.mem.Allocator;
const allocator = std.heap.wasm_allocator;

pub const std_options: std.Options = .{
    .logFn = wasmLog,
};

fn wasmLog(
    comptime level: std.log.Level,
    comptime scope: @TypeOf(.EnumLiteral),
    comptime format: []const u8,
    args: anytype,
) void {
    _ = level;
    _ = scope;
    var buf: [2048]u8 = undefined;
    const str = std.fmt.bufPrint(&buf, format, args) catch return;
    JS.log(str.ptr, str.len);
}

const JS = struct {
    extern "env" fn log(ptr: [*]const u8, len: usize) void;
};

// ---------------------------------------------------------------
// Cell layout written into the JS-owned viewport buffer.
// 16 bytes per cell, little-endian.
//
//  offset  size  field
//  ------  ----  -----
//       0     4  codepoint (u32)
//       4     1  fg_r
//       5     1  fg_g
//       6     1  fg_b
//       7     1  bg_r
//       8     1  bg_g
//       9     1  bg_b
//      10     1  flags  (bold=1, faint=2, italic=4, underline=8,
//                        blink=16, inverse=32, invisible=64,
//                        strikethrough=128)
//      11     1  width  (0 = spacer, 1 = normal, 2 = wide)
//      12     1  color_flags (bit 0 = has explicit fg,
//                             bit 1 = has explicit bg)
//      13     3  reserved
// ---------------------------------------------------------------
const CELL_BYTES = 16;

const State = struct {
    terminal: Terminal,
    stream: vt.ReadonlyStream,
    render: RenderState,
};

fn stateFromPtr(ptr: usize) *State {
    return @ptrFromInt(ptr);
}

// -- Lifecycle --------------------------------------------------

export fn init(cols: u16, rows: u16, max_scrollback: u32) usize {
    const state = allocator.create(State) catch return 0;
    state.terminal = Terminal.init(allocator, .{
        .cols = cols,
        .rows = rows,
        .max_scrollback = max_scrollback,
    }) catch {
        allocator.destroy(state);
        return 0;
    };
    state.stream = state.terminal.vtStream();
    state.render = RenderState.empty;
    return @intFromPtr(state);
}

export fn deinit(ptr: usize) void {
    const state = stateFromPtr(ptr);
    state.render.deinit(allocator);
    state.stream.deinit();
    state.terminal.deinit(allocator);
    allocator.destroy(state);
}

export fn resize(ptr: usize, cols: u16, rows: u16) void {
    const state = stateFromPtr(ptr);
    state.terminal.resize(allocator, cols, rows) catch {};
}

// -- Data input -------------------------------------------------

export fn write(ptr: usize, data_ptr: [*]const u8, data_len: u32) void {
    const state = stateFromPtr(ptr);
    state.stream.nextSlice(data_ptr[0..data_len]) catch {};
}

// -- Render state -----------------------------------------------

export fn update(ptr: usize) void {
    const state = stateFromPtr(ptr);
    state.render.update(allocator, &state.terminal) catch {};
}

fn packFlags(style: Style) u8 {
    var f: u8 = 0;
    if (style.flags.bold) f |= 0x01;
    if (style.flags.faint) f |= 0x02;
    if (style.flags.italic) f |= 0x04;
    if (style.flags.underline != .none) f |= 0x08;
    if (style.flags.blink) f |= 0x10;
    if (style.flags.inverse) f |= 0x20;
    if (style.flags.invisible) f |= 0x40;
    if (style.flags.strikethrough) f |= 0x80;
    return f;
}

fn resolveRgb(c: Style.Color, palette: *const color.Palette) color.RGB {
    return switch (c) {
        .none => .{},
        .palette => |idx| palette[idx],
        .rgb => |rgb| rgb,
    };
}

fn cellWidth(cell: vt.Cell) u8 {
    return switch (cell.wide) {
        .narrow => 1,
        .wide => 2,
        .spacer_tail, .spacer_head => 0,
    };
}

/// Write the entire viewport into a JS-provided flat buffer.
/// Returns the number of cells written (rows * cols).
export fn get_viewport(ptr: usize, buf_ptr: [*]u8) u32 {
    const state = stateFromPtr(ptr);
    const rs = &state.render;
    const rows = rs.rows;
    const cols = rs.cols;
    const palette = &rs.colors.palette;

    const row_cells_slice = rs.row_data.items(.cells);

    var offset: usize = 0;
    for (0..rows) |y| {
        if (y >= row_cells_slice.len) {
            // Pad remaining rows with blank cells
            const remaining = (@as(usize, rows) - y) * @as(usize, cols) * CELL_BYTES;
            @memset(buf_ptr[offset .. offset + remaining], 0);
            break;
        }
        const cells_mal = row_cells_slice[y];
        const raw_cells = cells_mal.items(.raw);
        const style_cells = cells_mal.items(.style);

        for (0..cols) |x| {
            if (x >= raw_cells.len) {
                @memset(buf_ptr[offset .. offset + CELL_BYTES], 0);
                offset += CELL_BYTES;
                continue;
            }
            const raw = raw_cells[x];
            const style = style_cells[x];

            const cp: u32 = switch (raw.content_tag) {
                .codepoint, .codepoint_grapheme => raw.content.codepoint,
                else => 0,
            };

            const has_fg = style.fg_color != .none;
            const has_bg_style = style.bg_color != .none;
            const has_bg_cell = raw.content_tag == .bg_color_palette or raw.content_tag == .bg_color_rgb;
            const has_bg = has_bg_style or has_bg_cell;

            const fg = if (has_fg) resolveRgb(style.fg_color, palette) else color.RGB{};
            const bg = if (has_bg_cell) switch (raw.content_tag) {
                .bg_color_palette => palette[raw.content.color_palette],
                .bg_color_rgb => blk: {
                    const c = raw.content.color_rgb;
                    break :blk color.RGB{ .r = c.r, .g = c.g, .b = c.b };
                },
                else => unreachable,
            } else if (has_bg_style) resolveRgb(style.bg_color, palette) else color.RGB{};

            const flags = packFlags(style);
            const width = cellWidth(raw);
            const color_flags: u8 = (if (has_fg) @as(u8, 1) else 0) | (if (has_bg) @as(u8, 2) else 0);

            std.mem.writeInt(u32, buf_ptr[offset..][0..4], cp, .little);
            buf_ptr[offset + 4] = fg.r;
            buf_ptr[offset + 5] = fg.g;
            buf_ptr[offset + 6] = fg.b;
            buf_ptr[offset + 7] = bg.r;
            buf_ptr[offset + 8] = bg.g;
            buf_ptr[offset + 9] = bg.b;
            buf_ptr[offset + 10] = flags;
            buf_ptr[offset + 11] = width;
            buf_ptr[offset + 12] = color_flags;
            buf_ptr[offset + 13] = 0;
            buf_ptr[offset + 14] = 0;
            buf_ptr[offset + 15] = 0;
            offset += CELL_BYTES;
        }
    }

    return @as(u32, rows) * @as(u32, cols);
}

// -- Dirty tracking ---------------------------------------------

export fn is_dirty(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return switch (state.render.dirty) {
        .false => 0,
        .partial => 1,
        .full => 2,
    };
}

export fn is_dirty_row(ptr: usize, row: u16) u32 {
    const state = stateFromPtr(ptr);
    const row_dirty = state.render.row_data.items(.dirty);
    if (row >= row_dirty.len) return 0;
    return if (row_dirty[row]) 1 else 0;
}

export fn clear_dirty(ptr: usize) void {
    const state = stateFromPtr(ptr);
    state.render.dirty = .false;
    const row_dirty = state.render.row_data.items(.dirty);
    for (row_dirty) |*d| d.* = false;
}

// -- Cursor -----------------------------------------------------

export fn get_cursor_row(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return state.render.cursor.active.y;
}

export fn get_cursor_col(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return state.render.cursor.active.x;
}

export fn get_cursor_visible(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return if (state.render.cursor.visible) 1 else 0;
}

// -- Modes ------------------------------------------------------

export fn cursor_keys_app(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return if (state.terminal.modes.get(.cursor_keys)) 1 else 0;
}

export fn bracketed_paste(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return if (state.terminal.modes.get(.bracketed_paste)) 1 else 0;
}

export fn using_alt_screen(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return if (state.terminal.screens.active_key != .primary) 1 else 0;
}

// -- Grid dimensions --------------------------------------------

export fn get_cols(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return state.render.cols;
}

export fn get_rows(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return state.render.rows;
}

// -- Scrollback -------------------------------------------------

export fn get_scrollback_count(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    const screen: *Screen = state.terminal.screens.active;
    var total: usize = 0;
    var node_ = screen.pages.pages.first;
    while (node_) |node| : (node_ = node.next) {
        total += node.data.size.rows;
    }
    if (total <= state.terminal.rows) return 0;
    return @intCast(total - state.terminal.rows);
}

export fn get_scrollback_line(ptr: usize, offset: u32, buf_ptr: [*]u8, max_cols: u32) u32 {
    _ = ptr;
    _ = offset;
    _ = buf_ptr;
    _ = max_cols;
    // TODO: scrollback line reading requires navigating the page list
    // backwards. This is a complex operation that will be implemented
    // when scrollback support is prioritized.
    return 0;
}

// -- Responses --------------------------------------------------

export fn read_response(ptr: usize, buf_ptr: [*]u8, buf_len: u32) u32 {
    _ = ptr;
    _ = buf_ptr;
    _ = buf_len;
    // The ReadonlyStream ignores queries that produce responses.
    // A full-featured stream handler would be needed to support
    // device status reports and other response-generating sequences.
    return 0;
}

// -- Memory management ------------------------------------------

export fn alloc_buffer(len: u32) usize {
    const buf = allocator.alloc(u8, len) catch return 0;
    return @intFromPtr(buf.ptr);
}

export fn free_buffer(buf_ptr: usize, len: u32) void {
    const slice: [*]u8 = @ptrFromInt(buf_ptr);
    allocator.free(slice[0..len]);
}

