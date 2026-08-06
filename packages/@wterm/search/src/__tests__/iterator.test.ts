import { describe, expect, it } from "vitest";
import { iterRows } from "../engine.js";
import { makeTerm } from "./helpers.js";

describe("iterRows", () => {
  it("yields oldest scrollback rows first, then grid rows", async () => {
    const term = await makeTerm(80, 3);

    for (let i = 0; i < 8; i++) {
      term.write(`iter-${i}\r\n`);
    }

    const rows = [...iterRows(term.bridge!)];
    const negatives = rows.filter((r) => r.row < 0);
    const grid = rows.filter((r) => r.row >= 0);

    if (negatives.length > 1) {
      for (let i = 1; i < negatives.length; i++) {
        expect(negatives[i]!.row).toBe(negatives[i - 1]!.row + 1);
      }
    }

    expect(grid.map((r) => r.row)).toEqual([0, 1, 2]);

    if (negatives.length > 0 && grid.length > 0) {
      expect(rows.indexOf(negatives[0]!)).toBeLessThan(rows.indexOf(grid[0]!));
    }
  });
});
