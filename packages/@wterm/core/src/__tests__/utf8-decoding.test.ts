import { describe, it, expect, beforeEach } from "vitest";
import { WasmBridge, sanitizeCodePoint } from "../wasm-bridge.js";

const REPLACEMENT = "�";

function rowText(bridge: WasmBridge, row = 0): string {
  let text = "";
  for (let col = 0; col < bridge.getCols(); col++) {
    const cell = bridge.getCell(row, col);
    if (cell.width === 0) continue;
    text += cell.char ? String.fromCodePoint(cell.char) : " ";
  }
  return text.trimEnd();
}

function isScalarValue(char: number): boolean {
  return char <= 0x10ffff && !(char >= 0xd800 && char <= 0xdfff);
}

describe("malformed UTF-8", () => {
  let bridge: WasmBridge;

  beforeEach(async () => {
    bridge = await WasmBridge.load();
    bridge.init(20, 4);
  });

  it("prints one replacement per byte of a lead above the four-byte range", () => {
    bridge.writeRaw(new Uint8Array([0xf7, 0xbf, 0xbf, 0xbf]));
    expect(rowText(bridge)).toBe(REPLACEMENT.repeat(4));
    expect(bridge.getCursor().col).toBe(4);
    for (let col = 0; col < 4; col++) {
      expect(isScalarValue(bridge.getCell(0, col).char)).toBe(true);
    }
  });

  it("keeps code points above U+10FFFF out of cells", () => {
    bridge.writeRaw(new Uint8Array([0xf4, 0x90, 0x80, 0x80]));
    expect(rowText(bridge)).toBe(REPLACEMENT.repeat(4));
    expect(bridge.getCell(0, 0).char).toBeLessThanOrEqual(0x10ffff);
  });

  it("prints one replacement per maximal subpart of overlong encodings", () => {
    bridge.writeRaw(new Uint8Array([0xc0, 0x80]));
    expect(rowText(bridge)).toBe(REPLACEMENT.repeat(2));

    bridge.init(20, 4);
    bridge.writeRaw(new Uint8Array([0xe0, 0x80, 0x80]));
    expect(rowText(bridge)).toBe(REPLACEMENT.repeat(3));
  });

  it("prints one replacement per maximal subpart of a surrogate", () => {
    bridge.writeRaw(new Uint8Array([0xed, 0xa0, 0x80]));
    expect(rowText(bridge)).toBe(REPLACEMENT.repeat(3));
    expect(bridge.getCell(0, 0).char).not.toBe(0xd800);
  });

  it("holds a truncated sequence at the end of a write", () => {
    bridge.writeRaw(new Uint8Array([0xe2, 0x82]));
    expect(rowText(bridge)).toBe("");
    expect(bridge.getCursor().col).toBe(0);

    bridge.writeRaw(new TextEncoder().encode(" "));
    expect(rowText(bridge)).toBe(REPLACEMENT);
  });

  it("replaces a truncated sequence the next write abandons", () => {
    bridge.writeRaw(new Uint8Array([0xe2, 0x82]));
    bridge.writeRaw(new TextEncoder().encode("A"));
    expect(rowText(bridge)).toBe(REPLACEMENT + "A");
  });

  it("keeps a sequence split across two writes intact", () => {
    bridge.writeRaw(new Uint8Array([0xe2]));
    bridge.writeRaw(new Uint8Array([0x82, 0xac]));
    expect(rowText(bridge)).toBe("€");
  });

  it("keeps a four-byte emoji intact", () => {
    bridge.writeRaw(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]));
    expect(rowText(bridge)).toBe("\u{1F600}");
    expect(bridge.getCell(0, 0)).toMatchObject({ char: 0x1f600, width: 2 });
    expect(bridge.getCell(0, 1).width).toBe(0);
  });

  it("keeps malformed history readable through text capture", () => {
    bridge.init(20, 3);
    bridge.writeRaw(
      new Uint8Array([
        0xf7, 0xbf, 0xbf, 0xbf, 0x0d, 0x0a, 0x0d, 0x0a, 0x0d, 0x0a,
      ]),
    );
    bridge.writeString("\x1b[2J");
    const offset = bridge.getScrollbackCount() - 1;
    expect(offset).toBeGreaterThanOrEqual(0);
    let text = "";
    for (let col = 0; col < bridge.getScrollbackLineLen(offset); col++) {
      const cell = bridge.getScrollbackCell(offset, col);
      expect(isScalarValue(cell.char)).toBe(true);
      if (cell.char) text += String.fromCodePoint(cell.char);
    }
    expect(text.trimEnd()).toBe(REPLACEMENT.repeat(4));
  });
});

describe("sanitizeCodePoint", () => {
  it("maps non-scalar values to U+FFFD and leaves scalars alone", () => {
    expect(sanitizeCodePoint(0x1fffff)).toBe(0xfffd);
    expect(sanitizeCodePoint(0x110000)).toBe(0xfffd);
    expect(sanitizeCodePoint(0xd800)).toBe(0xfffd);
    expect(sanitizeCodePoint(0xdfff)).toBe(0xfffd);
    expect(sanitizeCodePoint(0)).toBe(0);
    expect(sanitizeCodePoint(0x20ac)).toBe(0x20ac);
    expect(sanitizeCodePoint(0x10ffff)).toBe(0x10ffff);
  });
});
