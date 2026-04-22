import { describe, it, expect } from "vitest";
import { findUrls, trimTrailing, DEFAULT_URL_PATTERN } from "../linkify.js";

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
