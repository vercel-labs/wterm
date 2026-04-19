import type { WTerm } from "@wterm/dom";
import { describe, expect, it } from "vitest";
import { Search } from "../index.js";
import { makeTerm } from "./helpers.js";

describe("Search", () => {
  it("throws when terminal is not initialized", () => {
    expect(() => new Search({ bridge: null } as unknown as WTerm)).toThrow(
      "wterm: search requires an initialized terminal",
    );
  });

  it("findNext returns first match", async () => {
    const term = await makeTerm(40, 4);
    term.write("error one\r\nerror two\r\n");

    const search = new Search(term as WTerm);
    const match = search.findNext("error");

    expect(match).toEqual({ row: 0, col: 0, length: 5, text: "error" });
  });

  it("successive findNext returns second match", async () => {
    const term = await makeTerm(40, 4);
    term.write("error one error two\r\n");

    const search = new Search(term as WTerm);
    const first = search.findNext("error");
    const second = search.findNext("error");

    expect(first?.col).toBe(0);
    expect(second?.col).toBeGreaterThan(0);
  });

  it("findNext returns null when no more matches and cursor stays put", async () => {
    const term = await makeTerm(40, 4);
    term.write("error\r\n");

    const search = new Search(term as WTerm);
    const first = search.findNext("error");
    const none = search.findNext("error");
    const prev = search.findPrevious("error");

    expect(first).not.toBeNull();
    expect(none).toBeNull();
    expect(prev).not.toBeNull();
    expect(prev?.col).toBe(first?.col);
  });

  it("findPrevious walks backward", async () => {
    const term = await makeTerm(40, 4);
    term.write("error a error b error c\r\n");

    const search = new Search(term as WTerm);
    const m1 = search.findNext("error");
    const m2 = search.findNext("error");
    const m3 = search.findNext("error");

    const back1 = search.findPrevious("error");
    const back2 = search.findPrevious("error");

    expect(m1?.col).toBe(0);
    expect(m2?.col).toBeGreaterThan(m1!.col);
    expect(m3?.col).toBeGreaterThan(m2!.col);
    expect(back1?.col).toBe(m3?.col);
    expect(back2?.col).toBe(m2?.col);
  });

  it("reset returns cursor to top", async () => {
    const term = await makeTerm(40, 4);
    term.write("error one error two\r\n");

    const search = new Search(term as WTerm);
    const first = search.findNext("error");
    search.findNext("error");
    search.reset();
    const afterReset = search.findNext("error");

    expect(afterReset?.col).toBe(first?.col);
  });

  it("findAll returns all matches in oldest-first order", async () => {
    const term = await makeTerm(40, 3);
    term.write("match-1\r\nmatch-2\r\nmatch-3\r\nmatch-4\r\n");

    const search = new Search(term as WTerm);
    const matches = search.findAll("match");

    expect(matches.length).toBeGreaterThan(0);
    const rows = matches.map((m) => m.row);
    const sorted = [...rows].sort((a, b) => a - b);
    expect(rows).toEqual(sorted);
  });

  it("empty query returns null and empty list", async () => {
    const term = await makeTerm(40, 4);
    term.write("anything\r\n");

    const search = new Search(term as WTerm);

    expect(search.findNext("")).toBeNull();
    expect(search.findPrevious("")).toBeNull();
    expect(search.findAll("")).toEqual([]);
  });
});
