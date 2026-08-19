import { describe, expect, it } from "vitest";
import {
  encodeKittyKey,
  KITTY_REPORT_ALL,
  KITTY_REPORT_ALTERNATES,
  KITTY_REPORT_ASSOCIATED,
  KITTY_REPORT_EVENTS,
} from "../kitty-keys.js";

function key(
  value: string,
  init: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: value,
    code: init.code ?? value,
    ...init,
  });
}

const ALL_FLAGS =
  1 |
  KITTY_REPORT_EVENTS |
  KITTY_REPORT_ALTERNATES |
  KITTY_REPORT_ALL |
  KITTY_REPORT_ASSOCIATED;

describe("encodeKittyKey", () => {
  it("leaves plain text and recovery keys usable without report-all", () => {
    expect(encodeKittyKey(key("a", { code: "KeyA" }), 1, "press")).toBe("a");
    expect(
      encodeKittyKey(key("A", { code: "KeyA", shiftKey: true }), 1, "press"),
    ).toBe("A");
    expect(
      encodeKittyKey(key("!", { code: "Digit1", shiftKey: true }), 1, "press"),
    ).toBe("!");
    expect(encodeKittyKey(key("Enter"), 1, "press")).toBe("\r");
    expect(encodeKittyKey(key("Tab"), 1, "press")).toBe("\t");
    expect(encodeKittyKey(key("Backspace"), 1, "press")).toBe("\x7f");
  });

  it("keeps shifted text plain for every mode without report-all", () => {
    for (let flags = 1; flags < KITTY_REPORT_ALL; flags += 1) {
      const letter = key("A", { code: "KeyA", shiftKey: true });
      const punctuation = key("!", { code: "Digit1", shiftKey: true });
      expect(encodeKittyKey(letter, flags, "press")).toBe("A");
      expect(encodeKittyKey(letter, flags, "release")).toBeNull();
      expect(encodeKittyKey(punctuation, flags, "press")).toBe("!");
      expect(encodeKittyKey(punctuation, flags, "release")).toBeNull();
    }
  });

  it("keeps modified ASCII presses legacy without disambiguation", () => {
    const control = key("a", { code: "KeyA", ctrlKey: true });
    const alt = key("a", { code: "KeyA", altKey: true });
    const controlUnmapped = key(";", { code: "Semicolon", ctrlKey: true });
    const shiftedAlt = key("A", {
      code: "KeyA",
      shiftKey: true,
      altKey: true,
    });
    const shiftedControl = key("A", {
      code: "KeyA",
      shiftKey: true,
      ctrlKey: true,
    });
    for (const flags of [KITTY_REPORT_EVENTS, KITTY_REPORT_ALTERNATES]) {
      expect(encodeKittyKey(control, flags, "press")).toBe("\x01");
      expect(encodeKittyKey(alt, flags, "press")).toBe("\x1ba");
      expect(encodeKittyKey(controlUnmapped, flags, "press")).toBe(";");
      expect(encodeKittyKey(shiftedAlt, flags, "press")).toBe("\x1bA");
    }
    expect(encodeKittyKey(shiftedControl, KITTY_REPORT_EVENTS, "press")).toBe(
      "\x1b[97;6u",
    );
    expect(
      encodeKittyKey(shiftedControl, KITTY_REPORT_ALTERNATES, "press"),
    ).toBe("\x1b[97:65;6u");
    expect(encodeKittyKey(control, KITTY_REPORT_EVENTS, "repeat")).toBe(
      "\x1b[97;5:2u",
    );
    expect(encodeKittyKey(control, KITTY_REPORT_EVENTS, "release")).toBe(
      "\x1b[97;5:3u",
    );
  });

  it("encodes modified controls and navigation", () => {
    expect(encodeKittyKey(key("Enter", { shiftKey: true }), 1, "press")).toBe(
      "\x1b[13;2u",
    );
    expect(encodeKittyKey(key("Tab", { shiftKey: true }), 1, "press")).toBe(
      "\x1b[9;2u",
    );
    expect(encodeKittyKey(key("ArrowUp", { ctrlKey: true }), 1, "press")).toBe(
      "\x1b[1;5A",
    );
    expect(encodeKittyKey(key("Delete"), 1, "press")).toBe("\x1b[3~");
    expect(encodeKittyKey(key("F3"), 1, "press")).toBe("\x1b[13~");
  });

  it("reports printable alternates and associated text", () => {
    expect(
      encodeKittyKey(key("a", { code: "KeyA" }), KITTY_REPORT_ALL, "press"),
    ).toBe("\x1b[97u");
    expect(
      encodeKittyKey(
        key("a", { code: "KeyA" }),
        KITTY_REPORT_ALL | KITTY_REPORT_ASSOCIATED,
        "press",
      ),
    ).toBe("\x1b[97;;97u");
    expect(
      encodeKittyKey(
        key("a", { code: "KeyA" }),
        KITTY_REPORT_EVENTS | KITTY_REPORT_ALL | KITTY_REPORT_ASSOCIATED,
        "repeat",
      ),
    ).toBe("\x1b[97;1:2;97u");
    expect(
      encodeKittyKey(
        key("A", { code: "KeyA", shiftKey: true, ctrlKey: true }),
        1 | KITTY_REPORT_ALTERNATES,
        "press",
      ),
    ).toBe("\x1b[97:65;6u");
    expect(
      encodeKittyKey(
        key("J", { code: "KeyJ", shiftKey: true }),
        ALL_FLAGS,
        "press",
      ),
    ).toBe("\x1b[106:74;2;74u");
  });

  it("reports numpad text without inventing alternate layout fields", () => {
    expect(
      encodeKittyKey(key("1", { code: "Numpad1" }), ALL_FLAGS, "press"),
    ).toBe("\x1b[57400;;49u");
    expect(
      encodeKittyKey(key("Enter", { code: "NumpadEnter" }), 1, "press"),
    ).toBe("\x1b[57414u");
    expect(
      encodeKittyKey(key("End", { code: "Numpad1" }), ALL_FLAGS, "press"),
    ).toBe("\x1b[57424u");
    expect(
      encodeKittyKey(key("ArrowUp", { code: "Numpad8" }), ALL_FLAGS, "press"),
    ).toBe("\x1b[57419u");
  });

  it("does not treat functional key names as associated text", () => {
    expect(encodeKittyKey(key("Enter"), ALL_FLAGS, "press")).toBe("\x1b[13u");
    expect(encodeKittyKey(key("ArrowUp"), ALL_FLAGS, "press")).toBe(
      "\x1b[1;1:1A",
    );
  });

  it("reports modifier press and release when report-all is active", () => {
    const controlDown = key("Control", {
      code: "ControlLeft",
      ctrlKey: true,
    });
    const controlUp = new KeyboardEvent("keyup", {
      key: "Control",
      code: "ControlLeft",
      ctrlKey: false,
    });
    expect(encodeKittyKey(controlDown, ALL_FLAGS, "press")).toBe(
      "\x1b[57442;5u",
    );
    expect(encodeKittyKey(controlUp, ALL_FLAGS, "release")).toBe(
      "\x1b[57442;1:3u",
    );
    expect(
      encodeKittyKey(
        controlUp,
        ALL_FLAGS,
        "release",
        new Set(["ControlRight"]),
      ),
    ).toBe("\x1b[57442;5:3u");
  });

  it("reports repeats and omits release text", () => {
    const event = key("a", { code: "KeyA" });
    expect(encodeKittyKey(event, ALL_FLAGS, "repeat")).toBe("\x1b[97;1:2;97u");
    expect(encodeKittyKey(event, ALL_FLAGS, "release")).toBe("\x1b[97;1:3u");
  });

  it("requires report-events for release and report-all for recovery keys", () => {
    expect(
      encodeKittyKey(key("a", { code: "KeyA" }), KITTY_REPORT_ALL, "release"),
    ).toBeNull();
    expect(
      encodeKittyKey(
        key("a", { code: "KeyA" }),
        KITTY_REPORT_EVENTS,
        "release",
      ),
    ).toBeNull();
    expect(
      encodeKittyKey(
        key("a", { code: "KeyA", ctrlKey: true }),
        KITTY_REPORT_EVENTS,
        "release",
      ),
    ).toBe("\x1b[97;5:3u");
    expect(
      encodeKittyKey(key("Enter"), 1 | KITTY_REPORT_EVENTS, "release"),
    ).toBeNull();
    expect(encodeKittyKey(key("Enter"), ALL_FLAGS, "release")).toBe(
      "\x1b[13;1:3u",
    );
  });

  it("does not turn dead or unidentified keys into literal text", () => {
    expect(encodeKittyKey(key("Dead"), ALL_FLAGS, "press")).toBeNull();
    expect(encodeKittyKey(key("Unidentified"), ALL_FLAGS, "press")).toBeNull();
  });
});
