const std = @import("std");

pub const MAX_LINKS: u16 = 1024;
pub const MAX_URI_BYTES: u16 = 512;
pub const MAX_ID_BYTES: u16 = 128;

pub const Entry = struct {
    uri: [MAX_URI_BYTES]u8 = undefined,
    uri_len: u16 = 0,
    id: [MAX_ID_BYTES]u8 = undefined,
    id_len: u16 = 0,
};

pub const Table = struct {
    entries: [MAX_LINKS]Entry = undefined,
    count: u16 = 0,
    rejected: u32 = 0,

    pub fn reset(self: *Table) void {
        self.count = 0;
        self.rejected = 0;
    }

    pub fn open(self: *Table, uri: []const u8, id: ?[]const u8) u16 {
        if (uri.len == 0 or uri.len > MAX_URI_BYTES) return 0;
        const explicit_id = id orelse "";
        if (explicit_id.len > MAX_ID_BYTES) return 0;

        if (id != null) {
            var index: u16 = 1;
            while (index <= self.count) : (index += 1) {
                const entry = &self.entries[index - 1];
                if (std.mem.eql(u8, entry.uri[0..entry.uri_len], uri) and
                    std.mem.eql(u8, entry.id[0..entry.id_len], explicit_id))
                {
                    return index;
                }
            }
        }

        if (self.count == MAX_LINKS) {
            self.rejected +|= 1;
            return 0;
        }
        const entry = &self.entries[self.count];
        @memcpy(entry.uri[0..uri.len], uri);
        entry.uri_len = @intCast(uri.len);
        @memcpy(entry.id[0..explicit_id.len], explicit_id);
        entry.id_len = @intCast(explicit_id.len);
        self.count += 1;
        return self.count;
    }

    pub fn get(self: *const Table, index: u16) ?*const Entry {
        if (index == 0 or index > self.count) return null;
        return &self.entries[index - 1];
    }
};

test "table saturation fails closed without changing existing entries" {
    const testing = std.testing;
    var table = Table{};
    var uri_buf: [32]u8 = undefined;
    var i: u16 = 0;
    while (i < MAX_LINKS) : (i += 1) {
        const uri = try std.fmt.bufPrint(&uri_buf, "https://example.com/{d}", .{i});
        try testing.expectEqual(i + 1, table.open(uri, null));
    }
    try testing.expectEqual(@as(u16, 0), table.open("https://overflow.test", null));
    try testing.expectEqual(@as(u32, 1), table.rejected);
    try testing.expectEqualStrings(
        "https://example.com/0",
        table.get(1).?.uri[0..table.get(1).?.uri_len],
    );
}

test "rejection counter saturates" {
    const testing = std.testing;
    var table = Table{};
    table.count = MAX_LINKS;
    table.rejected = std.math.maxInt(u32);

    try testing.expectEqual(@as(u16, 0), table.open("https://overflow.test", null));
    try testing.expectEqual(std.math.maxInt(u32), table.rejected);
}
