pub const DEFAULT_COLOR: u16 = 256;

pub const FLAG_BOLD: u8 = 0x01;
pub const FLAG_DIM: u8 = 0x02;
pub const FLAG_ITALIC: u8 = 0x04;
pub const FLAG_UNDERLINE: u8 = 0x08;
pub const FLAG_BLINK: u8 = 0x10;
pub const FLAG_REVERSE: u8 = 0x20;
pub const FLAG_INVISIBLE: u8 = 0x40;
pub const FLAG_STRIKETHROUGH: u8 = 0x80;

pub const WIDTH_CONTINUATION: u8 = 0;
pub const WIDTH_NARROW: u8 = 1;
pub const WIDTH_WIDE: u8 = 2;

/// 12-byte extern struct with C-compatible layout so JS can read directly from WASM memory.
pub const Cell = extern struct {
    char: u32 = ' ',
    fg: u16 = DEFAULT_COLOR,
    bg: u16 = DEFAULT_COLOR,
    flags: u8 = 0,
    width: u8 = WIDTH_NARROW,
    _pad2: u8 = 0,
    _pad3: u8 = 0,

    pub const BYTE_SIZE = @sizeOf(Cell);
};
