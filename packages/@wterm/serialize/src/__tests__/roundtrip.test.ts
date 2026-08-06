import { describe, it, expect, beforeEach } from "vitest";
import { WasmBridge } from "@wterm/core";
import { restore, serialize } from "../index.js";
import { makeTerm } from "./helpers.js";

describe("roundtrip", () => {
  let bridge: WasmBridge;

  beforeEach(async () => {
    bridge = await WasmBridge.load();
    bridge.init(40, 10);
  });

  it("write Hello, world! -> serialize -> restore preserves chars", async () => {
    // Uses a minimal shim, not a real DOM WTerm, because serialize() only touches bridge + write().
    const term = await makeTerm(40, 10);
    term.write("Hello, world!");

    const snapshot = serialize(term as any);

    const restored = await makeTerm(40, 10);
    restore(restored as any, snapshot);

    for (let i = 0; i < "Hello, world!".length; i++) {
      expect(restored.bridge!.getCell(0, i).char).toBe(
        "Hello, world!".charCodeAt(i),
      );
    }
  });

  it("write ANSI with BOLD + color and preserves chars and flags", async () => {
    // Uses a minimal shim, not a real DOM WTerm, because serialize() only touches bridge + write().
    const term = await makeTerm(40, 10);
    term.write("\x1b[1;31mERR\x1b[0m OK");

    const snapshot = serialize(term as any);
    const restored = await makeTerm(40, 10);
    restore(restored as any, snapshot);

    expect(restored.bridge!.getCell(0, 0).char).toBe("E".charCodeAt(0));
    expect(restored.bridge!.getCell(0, 1).char).toBe("R".charCodeAt(0));
    expect(restored.bridge!.getCell(0, 2).char).toBe("R".charCodeAt(0));
    expect(restored.bridge!.getCell(0, 0).flags & 0x01).toBe(0x01);
  });

  it("cursor position preserved", async () => {
    // Uses a minimal shim, not a real DOM WTerm, because serialize() only touches bridge + write().
    const term = await makeTerm(40, 10);
    term.write("abc\r\nxy");

    const snapshot = serialize(term as any);
    const restored = await makeTerm(40, 10);
    restore(restored as any, snapshot);

    const cursor = restored.bridge!.getCursor();
    expect(cursor.row).toBe(snapshot.cursor.row);
    expect(cursor.col).toBe(snapshot.cursor.col);
    expect(cursor.visible).toBe(snapshot.cursor.visible);
  });

  it("throws for unsupported snapshot version", async () => {
    // Uses a minimal shim, not a real DOM WTerm, because serialize() only touches bridge + write().
    const term = await makeTerm(40, 10);
    const snapshot = serialize(term as any);
    const bad = { ...snapshot, version: 2 as 2 };

    expect(() => restore(term as any, bad as any)).toThrow(
      "wterm: unsupported snapshot version 2",
    );
  });

  it("throws when serialize called before init", () => {
    expect(() => serialize({ bridge: null } as any)).toThrow(
      "wterm: cannot serialize before init",
    );
  });

  it("throws when restore called before init", async () => {
    // Uses a minimal shim, not a real DOM WTerm, because serialize() only touches bridge + write().
    const term = await makeTerm(40, 10);
    const snapshot = serialize(term as any);

    expect(() =>
      restore({ bridge: null, write() {} } as any, snapshot),
    ).toThrow("wterm: cannot restore before init");
  });
});
