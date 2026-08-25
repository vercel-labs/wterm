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
    it("exposes OSC 8 metadata only on covered cells", () => {
      bridge.writeString(
        "\x1b]8;id=docs;https://example.com/docs\x07LINK\x1b]8;;\x1b\\ plain",
      );

      for (let col = 0; col < 4; col++) {
        expect(bridge.getCell(0, col)).toMatchObject({
          linkUri: "https://example.com/docs",
          linkId: "docs",
          linkKey: "e\u0000docs\u0000https://example.com/docs",
        });
      }
      expect(bridge.getCell(0, 4).linkUri).toBeUndefined();
    });

    it("keeps implicit OSC 8 identities distinct", () => {
      bridge.writeString(
        "\x1b]8;;https://example.com\x1b\\A\x1b]8;;\x1b\\" +
          "\x1b]8;;https://example.com\x1b\\B\x1b]8;;\x1b\\",
      );

      expect(bridge.getCell(0, 0).linkKey).toBeDefined();
      expect(bridge.getCell(0, 1).linkKey).toBeDefined();
      expect(bridge.getCell(0, 0).linkKey).not.toBe(
        bridge.getCell(0, 1).linkKey,
      );
    });

    it("clears OSC 8 metadata on overwrite and erase", () => {
      bridge.writeString("\x1b]8;;https://example.com\x1b\\LINK\x1b]8;;\x1b\\");
      bridge.writeString("\rX\x1b[K");

      expect(bridge.getCell(0, 0).linkUri).toBeUndefined();
      expect(bridge.getCell(0, 1).linkUri).toBeUndefined();
    });

    it("keeps erased cells unlinked while an OSC 8 link remains active", () => {
      bridge.writeString("\x1b]8;;https://example.com\x1b\\LINK");
      bridge.writeString("\r\x1b[K");

      expect(bridge.getCell(0, 0).linkUri).toBeUndefined();
      expect(bridge.getCell(0, 1).linkUri).toBeUndefined();
      bridge.writeString("Z");
      expect(bridge.getCell(0, 0).linkUri).toBe("https://example.com");
    });

    it("does not alias hyperlink destinations after RIS", () => {
      bridge.writeString("\x1b]8;;https://a.example\x1b\\A\x1b]8;;\x1b\\");
      expect(bridge.getCell(0, 0).linkUri).toBe("https://a.example");

      bridge.writeString("\x1bc");
      bridge.writeString("\x1b]8;;https://b.example\x1b\\B\x1b]8;;\x1b\\");

      expect(bridge.getCell(0, 0).linkUri).toBe("https://b.example");
    });

    it("reports hyperlink identity saturation to the host", () => {
      bridge.init(2, 2);
      for (let index = 0; index < 1025; index++) {
        bridge.writeString(
          `\x1b]8;;https://example.com/${index}\x1b\\X\x1b]8;;\x1b\\\r\n`,
        );
      }

      const state = (
        bridge as unknown as {
          getResourceState?: () => {
            hyperlinks: {
              capacity: number;
              used: number;
              rejected: number;
              saturated: boolean;
            };
          };
        }
      ).getResourceState?.();

      expect(state?.hyperlinks).toEqual({
        capacity: 1024,
        used: 1024,
        rejected: 1,
        saturated: true,
      });
    });

    it("preserves hyperlink saturation state across RIS and clears it on init", () => {
      bridge.init(2, 2);
      for (let index = 0; index < 1025; index++) {
        bridge.writeString(
          `\x1b]8;;https://example.com/${index}\x1b\\X\x1b]8;;\x1b\\\r\n`,
        );
      }

      bridge.writeString("\x1bc");
      expect(bridge.getResourceState().hyperlinks).toMatchObject({
        used: 1024,
        rejected: 1,
        saturated: true,
      });

      bridge.init(2, 2);
      expect(bridge.getResourceState().hyperlinks).toEqual({
        capacity: 1024,
        used: 0,
        rejected: 0,
        saturated: false,
      });
    });

    it("returns no resource state when an older WASM lacks the exports", () => {
      const internals = bridge as unknown as {
        exports: Record<string, WebAssembly.ExportValue>;
      };
      const exportsWithoutResourceState = { ...internals.exports };
      delete exportsWithoutResourceState.getHyperlinkCapacity;
      delete exportsWithoutResourceState.getHyperlinkCount;
      delete exportsWithoutResourceState.getHyperlinkRejectedCount;
      internals.exports = exportsWithoutResourceState;

      expect(bridge.getResourceState()).toEqual({});
    });

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

    it("tracks wide cells and continuation cells", () => {
      bridge.writeString("📁a");
      expect(bridge.getCell(0, 0).char).toBe(0x1f4c1);
      expect(bridge.getCell(0, 0).width).toBe(2);
      expect(bridge.getCell(0, 1).width).toBe(0);
      expect(bridge.getCell(0, 2).char).toBe(97); // 'a'
      expect(bridge.getCursor().col).toBe(3);
    });

    it("keeps cursor-positioned redraws aligned after wide characters", () => {
      bridge.writeString("📁abcd");
      bridge.writeString("\x1b[1;4Hx");
      expect(bridge.getCell(0, 2).char).toBe(97); // 'a'
      expect(bridge.getCell(0, 3).char).toBe(120); // 'x'
      expect(bridge.getCell(0, 4).char).toBe(99); // 'c'
      expect(bridge.getCell(0, 5).char).toBe(100); // 'd'
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

    it("tracks synchronized output mode", () => {
      expect(bridge.synchronizedOutput()).toBe(false);
      bridge.writeString("\x1b[?2026h");
      expect(bridge.synchronizedOutput()).toBe(true);
      bridge.writeString("\x1b[?2026l");
      expect(bridge.synchronizedOutput()).toBe(false);
    });
  });

  describe("terminal responses", () => {
    it("dequeues consecutive CPR responses in order", () => {
      bridge.writeString("\x1b[1G\x1b[6n\x1b[2G\x1b[6n");
      expect(bridge.getResponse()).toBe("\x1b[1;1R");
      expect(bridge.getResponse()).toBe("\x1b[1;2R");
      expect(bridge.getResponse()).toBeNull();
    });

    it("clears queued responses on init", () => {
      bridge.writeString("\x1b[6n\x1b[6n");
      bridge.init(80, 24);
      expect(bridge.getResponse()).toBeNull();
    });

    it("allows responses to drain between internal write chunks", () => {
      const responses: string[] = [];
      bridge.writeString("\x1b[6n".repeat(2049), () => {
        let response: string | null;
        while ((response = bridge.getResponse()) !== null) {
          responses.push(response);
        }
      });

      expect(responses).toHaveLength(2049);
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

    it("keeps OSC 8 metadata after a row enters scrollback", () => {
      bridge.writeString(
        "\x1b]8;;https://example.com/history\x1b\\LINK\x1b]8;;\x1b\\\r\n",
      );
      for (let i = 0; i < 30; i++) bridge.writeString(`line ${i}\r\n`);

      const offset = bridge.getScrollbackCount() - 1;
      expect(bridge.getScrollbackCell(offset, 0).linkUri).toBe(
        "https://example.com/history",
      );
      expect(bridge.getScrollbackCell(offset, 4).linkUri).toBeUndefined();
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

    it("counts rows discarded after the scrollback ring fills", () => {
      bridge.init(2, 2);
      bridge.writeString(
        Array.from({ length: 1005 }, (_, index) => `${index}\r\n`).join(""),
      );

      expect(bridge.getScrollbackCount()).toBe(1000);
      expect(bridge.getScrollbackDiscardedCount()).toBeGreaterThan(0);
    });
  });
});
