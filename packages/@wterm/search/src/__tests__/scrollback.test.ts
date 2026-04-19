import type { WTerm } from "@wterm/dom";
import { describe, expect, it } from "vitest";
import { Search } from "../index.js";
import { makeTerm } from "./helpers.js";

describe("Search scrollback", () => {
  it("finds matches in negative-row scrollback entries", async () => {
    const term = await makeTerm(80, 10);

    for (let i = 0; i < 30; i++) {
      term.write(`line-${i}\r\n`);
    }

    const search = new Search(term as WTerm);
    const match = search.findNext("line-0");

    expect(match).not.toBeNull();
    expect(match!.row).toBeLessThan(0);
    expect(match!.text).toBe("line-0");
  });
});
