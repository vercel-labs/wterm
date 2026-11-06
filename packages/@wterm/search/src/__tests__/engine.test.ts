import { describe, expect, it } from "vitest";
import { compileMatcher } from "../engine.js";

describe("compileMatcher", () => {
  it("literal match is case-insensitive by default", () => {
    const matcher = compileMatcher("error");
    expect(matcher.test("ERROR")).toBe(true);
  });

  it("caseSensitive true switches to case-sensitive", () => {
    const matcher = compileMatcher("Error", { caseSensitive: true });
    expect(matcher.test("Error")).toBe(true);
    matcher.lastIndex = 0;
    expect(matcher.test("error")).toBe(false);
  });

  it("regex true compiles user regex", () => {
    const matcher = compileMatcher("err(or)?", { regex: true });
    expect(matcher.test("error")).toBe(true);
    matcher.lastIndex = 0;
    expect(matcher.test("err")).toBe(true);
  });

  it("wholeWord wraps in word boundaries", () => {
    const matcher = compileMatcher("error", { wholeWord: true });
    expect(matcher.test("an error happened")).toBe(true);
    matcher.lastIndex = 0;
    expect(matcher.test("terror")).toBe(false);
  });

  it("invalid regex throws wrapped error", () => {
    expect(() => compileMatcher("(", { regex: true })).toThrow(
      /^wterm: invalid search pattern:/,
    );
  });
});
