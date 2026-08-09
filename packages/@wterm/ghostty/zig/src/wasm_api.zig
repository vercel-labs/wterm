const std = @import("std");
const builtin = @import("builtin");
const vt = @import("ghostty-vt");
const Terminal = vt.Terminal;
const Screen = vt.Screen;
const RenderState = vt.RenderState;
const Style = vt.Style;
const color = vt.color;
const modes = vt.modes;
const ReadonlyHandler = vt.ReadonlyHandler;
const StreamAction = vt.StreamAction;

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

// -- Responses --------------------------------------------------
//
// Queries reach the terminal on the same stream as everything else, and the
// host reads their answers back out one at a time. The queue is fixed-size and
// drops the newest response when full, so the answers that are kept stay in the
// order they were produced. This mirrors the built-in core's contract.

const RESPONSE_QUEUE_MAX = 256;
const RESPONSE_MAX_BYTES = 64;

const ResponseQueue = struct {
    slots: [RESPONSE_QUEUE_MAX][RESPONSE_MAX_BYTES]u8 = undefined,
    lens: [RESPONSE_QUEUE_MAX]u8 = [_]u8{0} ** RESPONSE_QUEUE_MAX,
    head: u16 = 0,
    tail: u16 = 0,
    count: u16 = 0,

    fn push(self: *ResponseQueue, bytes: []const u8) void {
        if (bytes.len > RESPONSE_MAX_BYTES) return;
        if (self.count == RESPONSE_QUEUE_MAX) return;
        @memcpy(self.slots[self.tail][0..bytes.len], bytes);
        self.lens[self.tail] = @intCast(bytes.len);
        self.tail = (self.tail + 1) % RESPONSE_QUEUE_MAX;
        self.count += 1;
    }

    fn pop(self: *ResponseQueue, out: []u8) u32 {
        if (self.count == 0) return 0;
        const len = self.lens[self.head];
        if (len > out.len) return 0;
        @memcpy(out[0..len], self.slots[self.head][0..len]);
        self.head = (self.head + 1) % RESPONSE_QUEUE_MAX;
        self.count -= 1;
        return len;
    }
};

/// Wraps ghostty's own readonly handler instead of reimplementing it. Every
/// action that mutates terminal state is delegated untouched; only the query
/// actions, which the readonly handler documents as having "no terminal
/// modifying effect" and drops, are answered here.
const ResponseHandler = struct {
    inner: ReadonlyHandler,
    queue: *ResponseQueue,

    pub fn init(terminal: *Terminal, queue: *ResponseQueue) ResponseHandler {
        return .{ .inner = .init(terminal), .queue = queue };
    }

    pub fn deinit(self: *ResponseHandler) void {
        self.inner.deinit();
    }

    pub fn vt(
        self: *ResponseHandler,
        comptime action: StreamAction.Tag,
        value: StreamAction.Value(action),
    ) !void {
        switch (action) {
            .device_attributes => switch (value) {
                // VT100 with the advanced video option, matching the control
                // the parity suite measures against. Every code claimed here
                // must have a handler; do not widen it without one.
                .primary => self.queue.push("\x1b[?1;2c"),
                else => {},
            },
            .device_status => switch (value.request) {
                .operating_status => self.queue.push("\x1b[0n"),
                .cursor_position => {
                    const cursor = self.inner.terminal.screens.active.cursor;
                    var buf: [RESPONSE_MAX_BYTES]u8 = undefined;
                    const out = std.fmt.bufPrint(
                        &buf,
                        "\x1b[{d};{d}R",
                        .{ cursor.y + 1, cursor.x + 1 },
                    ) catch return;
                    self.queue.push(out);
                },
                else => {},
            },
            .request_mode => {
                // DECRPM reads the same mode state the set/reset path writes,
                // so a reported mode cannot drift from the implemented one.
                // Mode packs its number together with an ansi flag, and only
                // DEC private modes carry the `?` prefix, so both come from
                // the unpacked tag rather than the raw enum value.
                const mode = value.mode;
                const set = self.inner.terminal.modes.get(mode);
                const tag: modes.ModeTag = @bitCast(@intFromEnum(mode));
                var buf: [RESPONSE_MAX_BYTES]u8 = undefined;
                const out = std.fmt.bufPrint(
                    &buf,
                    "\x1b[{s}{d};{d}$y",
                    .{
                        if (tag.ansi) "" else "?",
                        tag.value,
                        @as(u8, if (set) 1 else 2),
                    },
                ) catch return;
                self.queue.push(out);
            },
            .request_mode_unknown => {
                var buf: [RESPONSE_MAX_BYTES]u8 = undefined;
                const out = std.fmt.bufPrint(
                    &buf,
                    "\x1b[{s}{d};0$y",
                    .{ if (value.ansi) "" else "?", value.mode },
                ) catch return;
                self.queue.push(out);
            },
            else => try self.inner.vt(action, value),
        }
    }
};

const ResponseStream = vt.Stream(ResponseHandler);

const State = struct {
    terminal: Terminal,
    stream: ResponseStream,
    render: RenderState,
    responses: ResponseQueue,
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
    state.responses = .{};
    state.stream = .initAlloc(allocator, .init(&state.terminal, &state.responses));
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
        // Width 0 means "continuation of the wide cell to my left", which the
        // renderer skips. Only the tail is that. A spacer head is the blank
        // left at the right margin when a wide glyph wrapped to the next row:
        // it follows a narrow cell and owns its column.
        .spacer_tail => 0,
        .spacer_head => 1,
    };
}

/// Encode one cell into the 16-byte layout described above.
///
/// This mirrors the packing get_viewport does inline. The two are kept
/// separate because get_viewport reads RenderState, which only covers the
/// active area, while scrollback reads page memory directly. Changes to the
/// cell contract belong in both.
fn encodeCell(
    raw: *const vt.Cell,
    style: Style,
    palette: *const color.Palette,
    out: *[CELL_BYTES]u8,
) void {
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

    std.mem.writeInt(u32, out[0..4], cp, .little);
    out[4] = fg.r;
    out[5] = fg.g;
    out[6] = fg.b;
    out[7] = bg.r;
    out[8] = bg.g;
    out[9] = bg.b;
    out[10] = packFlags(style);
    out[11] = cellWidth(raw.*);
    out[12] = (if (has_fg) @as(u8, 1) else 0) | (if (has_bg) @as(u8, 2) else 0);
    out[13] = 0;
    out[14] = 0;
    out[15] = 0;
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
            // RenderState.Cell.style is undefined unless the raw cell carries a
            // non-default style_id. The style array is reused across render
            // passes, so reading it unconditionally resurfaces the style of
            // whatever occupied this cell before, including a different screen.
            const style: Style = if (raw.style_id != 0) style_cells[x] else .{};

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

export fn mouse_tracking(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return switch (state.terminal.flags.mouse_event) {
        .normal => 1000,
        .button => 1002,
        else => 0,
    };
}

export fn mouse_sgr(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return if (state.terminal.flags.mouse_format == .sgr) 1 else 0;
}

export fn focus_events(ptr: usize) u32 {
    const state = stateFromPtr(ptr);
    return if (state.terminal.modes.get(.focus_event)) 1 else 0;
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

/// Write one scrollback row into a JS-provided buffer, using the same cell
/// layout as get_viewport.
///
/// Offset 0 is the row directly above the active area (the newest retained
/// row) and offset get_scrollback_count() - 1 is the oldest, matching the
/// order the renderer inserts rows in and the built-in core's readback.
///
/// Returns the number of cells written, which is the row's grid width capped
/// at max_cols, or 0 when the offset is out of range. This reads the page list
/// rather than RenderState, which only covers the active area.
export fn get_scrollback_line(ptr: usize, offset: u32, buf_ptr: [*]u8, max_cols: u32) u32 {
    const state = stateFromPtr(ptr);
    const screen: *Screen = state.terminal.screens.active;

    // Walking up from the active top means small offsets, the ones the
    // renderer asks for while scrolling, traverse the fewest pages.
    // usize is 32-bit on wasm32, so offset is caller-supplied input that can
    // overflow this increment and wrap to the newest row.
    const rows_up = std.math.add(usize, offset, 1) catch return 0;
    const pin = screen.pages.getTopLeft(.active).up(rows_up) orelse return 0;

    const palette = &state.terminal.colors.palette.current;
    const cells = pin.cells(.all);
    const count = @min(cells.len, max_cols);

    var buf_offset: usize = 0;
    for (cells[0..count]) |*raw| {
        // Pin.style applies the same style_id gating get_viewport relies on.
        const style = pin.style(raw);
        encodeCell(raw, style, palette, buf_ptr[buf_offset..][0..CELL_BYTES]);
        buf_offset += CELL_BYTES;
    }

    return @intCast(count);
}

// -- Responses --------------------------------------------------

export fn read_response(ptr: usize, buf_ptr: [*]u8, buf_len: u32) u32 {
    const state = stateFromPtr(ptr);
    return state.responses.pop(buf_ptr[0..buf_len]);
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
