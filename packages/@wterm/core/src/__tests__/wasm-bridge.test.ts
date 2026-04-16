import { describe, it, expect, beforeEach } from "vitest";
import { WasmBridge } from "../wasm-bridge.js";

describe("WasmBridge", () => {
  let bridge: WasmBridge;

  beforeEach(async () => {
    bridge = await WasmBridge.load();
    bridge.init(80, 24);
  });

  describe("load", () => {
    it("loads from inline base64", async () => {
      const b = await WasmBridge.load();
      expect(b).toBeInstanceOf(WasmBridge);
    });

    it("throws on invalid URL fetch", async () => {
      await expect(
        WasmBridge.load("http://localhost:99999/nonexistent.wasm"),
      ).rejects.toThrow();
    });
  });

  describe("init", () => {
    it("sets cols and rows", () => {
      expect(bridge.getCols()).toBe(80);
      expect(bridge.getRows()).toBe(24);
    });
  });

  describe("writeString / getCell", () => {
    it("writes a character to the grid", () => {
      bridge.writeString("A");
      const cell = bridge.getCell(0, 0);
      expect(cell.char).toBe(65); // 'A'
    });

    it("writes multiple characters sequentially", () => {
      bridge.writeString("Hi");
      expect(bridge.getCell(0, 0).char).toBe(72); // 'H'
      expect(bridge.getCell(0, 1).char).toBe(105); // 'i'
    });

    it("writes to correct position after cursor movement", () => {
      bridge.writeString("AB\r\nCD");
      expect(bridge.getCell(0, 0).char).toBe(65); // 'A'
      expect(bridge.getCell(0, 1).char).toBe(66); // 'B'
      expect(bridge.getCell(1, 0).char).toBe(67); // 'C'
      expect(bridge.getCell(1, 1).char).toBe(68); // 'D'
    });
  });

  describe("writeRaw", () => {
    it("writes raw bytes to the terminal", () => {
      const data = new TextEncoder().encode("X");
      bridge.writeRaw(data);
      expect(bridge.getCell(0, 0).char).toBe(88); // 'X'
    });
  });

  describe("cursor", () => {
    it("returns initial cursor at 0,0", () => {
      const cursor = bridge.getCursor();
      expect(cursor.row).toBe(0);
      expect(cursor.col).toBe(0);
      expect(cursor.visible).toBe(true);
    });

    it("advances cursor after writing", () => {
      bridge.writeString("Hello");
      const cursor = bridge.getCursor();
      expect(cursor.col).toBe(5);
      expect(cursor.row).toBe(0);
    });

    it("moves to next row after newline", () => {
      bridge.writeString("A\r\nB");
      const cursor = bridge.getCursor();
      expect(cursor.row).toBe(1);
      expect(cursor.col).toBe(1);
    });
  });

  describe("dirty rows", () => {
    it("marks rows dirty after writing", () => {
      bridge.writeString("text");
      expect(bridge.isDirtyRow(0)).toBe(true);
    });

    it("clears dirty flags", () => {
      bridge.writeString("text");
      bridge.clearDirty();
      expect(bridge.isDirtyRow(0)).toBe(false);
    });
  });

  describe("resize", () => {
    it("changes cols and rows", () => {
      bridge.resize(40, 12);
      expect(bridge.getCols()).toBe(40);
      expect(bridge.getRows()).toBe(12);
    });

    it("preserves content after resize", () => {
      bridge.writeString("A");
      bridge.resize(40, 12);
      expect(bridge.getCell(0, 0).char).toBe(65);
    });
  });

  describe("SGR attributes", () => {
    it("tracks foreground color", () => {
      bridge.writeString("\x1b[31mR");
      const cell = bridge.getCell(0, 0);
      expect(cell.char).toBe(82); // 'R'
      expect(cell.fg).not.toBe(256); // not default
    });

    it("tracks bold flag", () => {
      bridge.writeString("\x1b[1mB");
      const cell = bridge.getCell(0, 0);
      expect(cell.flags & 0x01).toBe(0x01);
    });
  });

  describe("mode flags", () => {
    it("defaults cursorKeysApp to false", () => {
      expect(bridge.cursorKeysApp()).toBe(false);
    });

    it("enables cursor keys application mode", () => {
      bridge.writeString("\x1b[?1h");
      expect(bridge.cursorKeysApp()).toBe(true);
    });

    it("defaults bracketedPaste to false", () => {
      expect(bridge.bracketedPaste()).toBe(false);
    });

    it("enables bracketed paste mode", () => {
      bridge.writeString("\x1b[?2004h");
      expect(bridge.bracketedPaste()).toBe(true);
    });

    it("defaults usingAltScreen to false", () => {
      expect(bridge.usingAltScreen()).toBe(false);
    });

    it("enters alt screen buffer", () => {
      bridge.writeString("\x1b[?1049h");
      expect(bridge.usingAltScreen()).toBe(true);
    });

    it("exits alt screen buffer", () => {
      bridge.writeString("\x1b[?1049h");
      bridge.writeString("\x1b[?1049l");
      expect(bridge.usingAltScreen()).toBe(false);
    });
  });

  describe("title", () => {
    it("returns null when no title set", () => {
      expect(bridge.getTitle()).toBeNull();
    });

    it("captures OSC title sequence", () => {
      bridge.writeString("\x1b]0;My Title\x07");
      const title = bridge.getTitle();
      expect(title).toBe("My Title");
    });
  });

  describe("scrollback", () => {
    it("starts with zero scrollback", () => {
      expect(bridge.getScrollbackCount()).toBe(0);
    });

    it("accumulates scrollback when content overflows", () => {
      for (let i = 0; i < 30; i++) {
        bridge.writeString(`line ${i}\r\n`);
      }
      expect(bridge.getScrollbackCount()).toBeGreaterThan(0);
    });

    it("reads scrollback cell data", () => {
      for (let i = 0; i < 30; i++) {
        bridge.writeString(`A\r\n`);
      }
      const count = bridge.getScrollbackCount();
      if (count > 0) {
        const cell = bridge.getScrollbackCell(0, 0);
        expect(cell.char).toBe(65); // 'A'
      }
    });

    it("returns scrollback line length", () => {
      for (let i = 0; i < 30; i++) {
        bridge.writeString(`AB\r\n`);
      }
      const count = bridge.getScrollbackCount();
      if (count > 0) {
        const len = bridge.getScrollbackLineLen(0);
        expect(len).toBeGreaterThan(0);
      }
    });
  });
});
