import { describe, it, expect } from "vitest";
import { restore, serialize } from "../index.js";
import { makeTerm } from "./helpers.js";

describe("scrollback", () => {
  it("captures and restores scrollback", async () => {
    // Uses a minimal shim, not a real DOM WTerm, because serialize() only touches bridge + write().
    const term = await makeTerm(20, 10);

    for (let i = 0; i < 30; i++) {
      term.write(`line ${i}\r\n`);
    }

    const beforeCount = term.bridge!.getScrollbackCount();
    expect(beforeCount).toBeGreaterThan(0);

    const snapshot = serialize(term as any);

    const restored = await makeTerm(20, 10);
    restore(restored as any, snapshot);

    const afterCount = restored.bridge!.getScrollbackCount();
    expect(afterCount).toBe(beforeCount);

    const compare = Math.min(beforeCount, 5);
    for (let offset = 0; offset < compare; offset++) {
      const lenA = term.bridge!.getScrollbackLineLen(offset);
      const lenB = restored.bridge!.getScrollbackLineLen(offset);
      expect(lenB).toBe(lenA);

      const width = Math.min(lenA, 20);
      for (let col = 0; col < width; col++) {
        const a = term.bridge!.getScrollbackCell(offset, col);
        const b = restored.bridge!.getScrollbackCell(offset, col);
        expect(b.char).toBe(a.char);
      }
    }
  });
});
