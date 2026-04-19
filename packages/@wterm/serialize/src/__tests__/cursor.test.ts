import { describe, it, expect } from "vitest";
import { restore, serialize } from "../index.js";
import { makeTerm } from "./helpers.js";

describe("cursor", () => {
  it("preserves cursor position and visibility through roundtrip", async () => {
    // Uses a minimal shim, not a real DOM WTerm, because serialize() only touches bridge + write().
    const term = await makeTerm(20, 5);
    term.write("abc\r\nxy");
    term.write("\x1b[?25l");

    const snapshot = serialize(term as any);
    const restored = await makeTerm(20, 5);
    restore(restored as any, snapshot);

    const before = term.bridge!.getCursor();
    const after = restored.bridge!.getCursor();

    expect(after.row).toBe(before.row);
    expect(after.col).toBe(before.col);
    expect(after.visible).toBe(before.visible);
  });
});
