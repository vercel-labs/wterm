import { describe, it, expect } from "vitest";
import {
  DEFAULT_URL_PATTERN,
  findUrls,
  findUrlsAcrossRows,
  trimTrailing,
} from "../linkify.js";

describe("trimTrailing", () => {
  it("leaves clean URLs intact", () => {
    expect(trimTrailing("https://example.com/path")).toBe("https://example.com/path");
  });

  it("strips trailing period", () => {
    expect(trimTrailing("https://example.com.")).toBe("https://example.com");
  });

  it("strips multiple trailing punctuation chars", () => {
    expect(trimTrailing("https://x.com/a.")).toBe("https://x.com/a");
    expect(trimTrailing("https://x.com/a,")).toBe("https://x.com/a");
    expect(trimTrailing("https://x.com/a?!")).toBe("https://x.com/a");
  });

  it("keeps paired parentheses in Wikipedia-style URLs", () => {
    expect(trimTrailing("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
  });

  it("strips trailing ')' when unbalanced", () => {
    expect(trimTrailing("https://example.com/a)")).toBe("https://example.com/a");
  });
});

describe("findUrls", () => {
  it("finds a single URL", () => {
    const ranges = findUrls("go to https://example.com/ now");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({
      start: 6,
      end: 6 + "https://example.com/".length,
      url: "https://example.com/",
    });
  });

  it("finds multiple URLs on one line", () => {
    const text = "see http://a.com and https://b.com/x end";
    const ranges = findUrls(text);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].url).toBe("http://a.com");
    expect(ranges[1].url).toBe("https://b.com/x");
  });

  it("strips trailing punctuation from ranges", () => {
    const text = "visit https://example.com.";
    const ranges = findUrls(text);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].url).toBe("https://example.com");
    // end must reflect stripped length
    expect(ranges[0].end).toBe(text.indexOf("https") + "https://example.com".length);
  });

  it("ignores non-URL text", () => {
    expect(findUrls("nothing interesting here")).toHaveLength(0);
    expect(findUrls("www.example.com (no scheme)")).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(findUrls("")).toHaveLength(0);
  });

  it("accepts a custom /g pattern", () => {
    const custom = /\bJIRA-\d+\b/g;
    const ranges = findUrls("see JIRA-123 and JIRA-456", custom);
    expect(ranges.map((r) => r.url)).toEqual(["JIRA-123", "JIRA-456"]);
  });

  it("rejects a non-global regex", () => {
    expect(() => findUrls("x", /https?:\/\/x/)).toThrow(/global/);
  });

  it("is safe to call repeatedly (lastIndex reset)", () => {
    const pattern = DEFAULT_URL_PATTERN;
    const r1 = findUrls("https://a.com", pattern);
    const r2 = findUrls("https://b.com", pattern);
    expect(r1[0].url).toBe("https://a.com");
    expect(r2[0].url).toBe("https://b.com");
  });
});

describe("findUrlsAcrossRows", () => {
  // Helper: pad a string to exactly cols chars.
  function pad(s: string, cols: number): string {
    return s.length >= cols ? s.slice(0, cols) : s + " ".repeat(cols - s.length);
  }

  it("joins a URL split across two rows into one full href", () => {
    const cols = 20;
    // URL spans the row boundary: 'https://example.com/' + 'page' = 24 chars
    const url = "https://example.com/page";
    const r0 = url.slice(0, cols); // "https://example.com/"
    const r1 = pad(url.slice(cols), cols); // "page"
    const ranges = findUrlsAcrossRows(
      [
        { rowText: r0, continuesNext: true },
        { rowText: r1, continuesNext: false },
      ],
      cols,
    );
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual([{ start: 0, end: cols, url }]);
    expect(ranges[1]).toEqual([{ start: 0, end: 4, url }]);
  });

  it("does not join when the row does not continue to the next", () => {
    const cols = 20;
    const r0 = pad("https://a.com", cols); // not full-width, doesn't continue
    const r1 = pad("more text", cols);
    const ranges = findUrlsAcrossRows(
      [
        { rowText: r0, continuesNext: false },
        { rowText: r1, continuesNext: false },
      ],
      cols,
    );
    expect(ranges[0]).toHaveLength(1);
    expect(ranges[0][0].url).toBe("https://a.com");
    expect(ranges[1]).toHaveLength(0);
  });

  it("joins across three rows when the chain continues", () => {
    const cols = 10;
    const url = "https://example.com/abc"; // 23 chars → spans cols 0..22
    const r0 = url.slice(0, 10); // "https://ex"
    const r1 = url.slice(10, 20); // "ample.com/"
    const r2 = pad(url.slice(20), cols); // "abc"
    const ranges = findUrlsAcrossRows(
      [
        { rowText: r0, continuesNext: true },
        { rowText: r1, continuesNext: true },
        { rowText: r2, continuesNext: false },
      ],
      cols,
    );
    expect(ranges[0][0]).toEqual({ start: 0, end: 10, url });
    expect(ranges[1][0]).toEqual({ start: 0, end: 10, url });
    expect(ranges[2][0]).toEqual({ start: 0, end: 3, url });
  });

  it("strips trailing punctuation from a wrapped URL's href", () => {
    const cols = 20;
    // ".com/page." trailing dot should be trimmed; period rendered as text on r1.
    const r0 = "https://example.com/"; // exactly cols
    const r1 = pad("page.", cols);
    const ranges = findUrlsAcrossRows(
      [
        { rowText: r0, continuesNext: true },
        { rowText: r1, continuesNext: false },
      ],
      cols,
    );
    expect(ranges[0][0].url).toBe("https://example.com/page");
    expect(ranges[1][0].url).toBe("https://example.com/page");
    // The trailing '.' on r1 is excluded from the range (col 4 not in [0,4))
    expect(ranges[1][0].end).toBe(4);
  });

  it("returns empty arrays for empty input", () => {
    expect(findUrlsAcrossRows([], 80)).toEqual([]);
  });

  it("handles a non-URL row that happens to fill its width", () => {
    const cols = 10;
    // A row of '=' filling the width is not a URL; joining is harmless.
    const r0 = "==========";
    const r1 = pad("done", cols);
    const ranges = findUrlsAcrossRows(
      [
        { rowText: r0, continuesNext: true },
        { rowText: r1, continuesNext: false },
      ],
      cols,
    );
    expect(ranges[0]).toHaveLength(0);
    expect(ranges[1]).toHaveLength(0);
  });

  it("rejects a non-global regex", () => {
    expect(() =>
      findUrlsAcrossRows(
        [{ rowText: "x".padEnd(80, " "), continuesNext: false }],
        80,
        /https?:\/\/x/,
      ),
    ).toThrow(/global/);
  });
});
