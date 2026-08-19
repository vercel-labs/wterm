export const KITTY_REPORT_EVENTS = 1 << 1;
export const KITTY_REPORT_ALTERNATES = 1 << 2;
export const KITTY_REPORT_ALL = 1 << 3;
export const KITTY_REPORT_ASSOCIATED = 1 << 4;

export type KittyKeyAction = "press" | "repeat" | "release";

type KittyKeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "shiftKey"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "getModifierState"
>;

interface KittyEntry {
  code: number;
  final: string;
  modifier?: boolean;
}

interface ResolvedKey {
  entry: KittyEntry;
  functionalKey: string | null;
}

const FUNCTIONAL_KEYS: Record<string, KittyEntry> = {
  Escape: { code: 27, final: "u" },
  Enter: { code: 13, final: "u" },
  Tab: { code: 9, final: "u" },
  Backspace: { code: 127, final: "u" },
  Insert: { code: 2, final: "~" },
  Delete: { code: 3, final: "~" },
  ArrowLeft: { code: 1, final: "D" },
  ArrowRight: { code: 1, final: "C" },
  ArrowUp: { code: 1, final: "A" },
  ArrowDown: { code: 1, final: "B" },
  PageUp: { code: 5, final: "~" },
  PageDown: { code: 6, final: "~" },
  Home: { code: 1, final: "H" },
  End: { code: 1, final: "F" },
  CapsLock: { code: 57358, final: "u", modifier: true },
  ScrollLock: { code: 57359, final: "u" },
  NumLock: { code: 57360, final: "u", modifier: true },
  PrintScreen: { code: 57361, final: "u" },
  Pause: { code: 57362, final: "u" },
  F1: { code: 1, final: "P" },
  F2: { code: 1, final: "Q" },
  F3: { code: 13, final: "~" },
  F4: { code: 1, final: "S" },
  F5: { code: 15, final: "~" },
  F6: { code: 17, final: "~" },
  F7: { code: 18, final: "~" },
  F8: { code: 19, final: "~" },
  F9: { code: 20, final: "~" },
  F10: { code: 21, final: "~" },
  F11: { code: 23, final: "~" },
  F12: { code: 24, final: "~" },
  ShiftLeft: { code: 57441, final: "u", modifier: true },
  ControlLeft: { code: 57442, final: "u", modifier: true },
  AltLeft: { code: 57443, final: "u", modifier: true },
  MetaLeft: { code: 57444, final: "u", modifier: true },
  ShiftRight: { code: 57447, final: "u", modifier: true },
  ControlRight: { code: 57448, final: "u", modifier: true },
  AltRight: { code: 57449, final: "u", modifier: true },
  MetaRight: { code: 57450, final: "u", modifier: true },
  Numpad0: { code: 57399, final: "u" },
  Numpad1: { code: 57400, final: "u" },
  Numpad2: { code: 57401, final: "u" },
  Numpad3: { code: 57402, final: "u" },
  Numpad4: { code: 57403, final: "u" },
  Numpad5: { code: 57404, final: "u" },
  Numpad6: { code: 57405, final: "u" },
  Numpad7: { code: 57406, final: "u" },
  Numpad8: { code: 57407, final: "u" },
  Numpad9: { code: 57408, final: "u" },
  NumpadDecimal: { code: 57409, final: "u" },
  NumpadDivide: { code: 57410, final: "u" },
  NumpadMultiply: { code: 57411, final: "u" },
  NumpadSubtract: { code: 57412, final: "u" },
  NumpadAdd: { code: 57413, final: "u" },
  NumpadEnter: { code: 57414, final: "u" },
  NumpadEqual: { code: 57415, final: "u" },
  NumpadComma: { code: 57416, final: "u" },
};

const KEYPAD_BEGIN: KittyEntry = { code: 1, final: "E" };

for (let index = 13; index <= 25; index++) {
  FUNCTIONAL_KEYS[`F${index}`] = {
    code: 57363 + index,
    final: "u",
  };
}

function codePoint(value: string): number | null {
  const chars = Array.from(value);
  return chars.length === 1 ? chars[0].codePointAt(0)! : null;
}

function printableEntry(event: KittyKeyEvent): KittyEntry | null {
  const current = codePoint(event.key);
  if (current === null || current < 0x20 || current === 0x7f) return null;
  const lower = event.key.toLowerCase();
  const primary = codePoint(lower);
  return { code: primary ?? current, final: "u" };
}

function resolveKey(
  event: KittyKeyEvent,
  normalizeKeypad: boolean,
): ResolvedKey | null {
  if (normalizeKeypad && event.code.startsWith("Numpad")) {
    if (event.code === "Numpad5" && event.key === "Clear") {
      return { entry: KEYPAD_BEGIN, functionalKey: "Begin" };
    }
    if (event.key.length === 1) {
      const entry = printableEntry(event);
      return entry ? { entry, functionalKey: null } : null;
    }
    const entry = FUNCTIONAL_KEYS[event.key];
    return entry ? { entry, functionalKey: event.key } : null;
  }

  const keypadNavigation = keypadNavigationEntry(event);
  if (keypadNavigation) {
    return { entry: keypadNavigation, functionalKey: event.code };
  }
  const byCode = FUNCTIONAL_KEYS[event.code];
  if (byCode) return { entry: byCode, functionalKey: event.code };
  const byKey = FUNCTIONAL_KEYS[event.key];
  if (byKey) return { entry: byKey, functionalKey: event.key };
  const printable = printableEntry(event);
  return printable ? { entry: printable, functionalKey: null } : null;
}

function keypadNavigationEntry(event: KittyKeyEvent): KittyEntry | null {
  const key = `${event.code}:${event.key}`;
  const code = {
    "Numpad4:ArrowLeft": 57417,
    "Numpad6:ArrowRight": 57418,
    "Numpad8:ArrowUp": 57419,
    "Numpad2:ArrowDown": 57420,
    "Numpad9:PageUp": 57421,
    "Numpad3:PageDown": 57422,
    "Numpad7:Home": 57423,
    "Numpad1:End": 57424,
    "Numpad0:Insert": 57425,
    "NumpadDecimal:Delete": 57426,
    "Numpad5:Clear": 57427,
  }[key];
  return code === undefined ? null : { code, final: "u" };
}

function hasModifier(
  prefix: string,
  pressedModifiers?: ReadonlySet<string>,
): boolean {
  for (const code of pressedModifiers ?? []) {
    if (code.startsWith(prefix)) return true;
  }
  return false;
}

function modifierValue(
  event: KittyKeyEvent,
  action: KittyKeyAction,
  pressedModifiers?: ReadonlySet<string>,
): number {
  let value = 1;
  const includeCurrent = action !== "release";
  if (
    event.shiftKey ||
    hasModifier("Shift", pressedModifiers) ||
    (includeCurrent && event.code.startsWith("Shift"))
  )
    value += 1;
  if (
    event.altKey ||
    hasModifier("Alt", pressedModifiers) ||
    (includeCurrent && event.code.startsWith("Alt"))
  )
    value += 2;
  if (
    event.ctrlKey ||
    hasModifier("Control", pressedModifiers) ||
    (includeCurrent && event.code.startsWith("Control"))
  )
    value += 4;
  if (
    event.metaKey ||
    hasModifier("Meta", pressedModifiers) ||
    (includeCurrent && event.code.startsWith("Meta"))
  )
    value += 8;
  if (event.getModifierState("CapsLock")) value += 64;
  if (event.getModifierState("NumLock")) value += 128;
  return value;
}

function associatedText(event: KittyKeyEvent): number[] {
  if (event.ctrlKey || event.metaKey || event.altKey) return [];
  return Array.from(event.key)
    .map((char) => char.codePointAt(0)!)
    .filter((point) => point >= 0x20 && point !== 0x7f);
}

function legacyModifiedText(event: KittyKeyEvent): string | null {
  if (event.metaKey) return null;
  const chars = Array.from(event.key);
  if (
    chars.length !== 1 ||
    chars[0].codePointAt(0)! < 0x20 ||
    chars[0].codePointAt(0)! > 0x7e
  )
    return null;

  if (event.shiftKey && event.ctrlKey && /^[a-z]$/i.test(event.key)) {
    return null;
  }

  if (event.ctrlKey) {
    const key = event.key.toLowerCase();
    const code = key.charCodeAt(0);
    let control = key;
    if (code >= 97 && code <= 122) control = String.fromCharCode(code - 96);
    else {
      control =
        {
          " ": "\0",
          "/": "\x1f",
          "2": "\0",
          "3": "\x1b",
          "4": "\x1c",
          "5": "\x1d",
          "6": "\x1e",
          "7": "\x1f",
          "8": "\x7f",
          "?": "\x7f",
          "@": "\0",
          "[": "\x1b",
          "\\": "\x1c",
          "]": "\x1d",
          "^": "\x1e",
          _: "\x1f",
          "~": "\x1e",
        }[key] ?? key;
    }
    return event.altKey ? `\x1b${control}` : control;
  }

  return event.altKey ? `\x1b${event.key}` : null;
}

function legacyFunctionalSequence(
  functionalKey: string,
  flags: number,
  action: KittyKeyAction,
  modifierBits: number,
  cursorKeysApp: boolean,
): { handled: boolean; sequence: string | null } {
  const disambiguate = Boolean(flags & 1);
  const reportEvents = Boolean(flags & KITTY_REPORT_EVENTS);
  const reportAll = Boolean(flags & KITTY_REPORT_ALL);
  const legacyMode = !disambiguate && !reportEvents && !reportAll;
  const nonLockModifiers = modifierBits & ~(64 | 128);

  if (cursorKeysApp && legacyMode && modifierBits === 0) {
    const appSequence = {
      ArrowUp: "\x1bOA",
      ArrowDown: "\x1bOB",
      ArrowRight: "\x1bOC",
      ArrowLeft: "\x1bOD",
      Begin: "\x1bOE",
      End: "\x1bOF",
      Home: "\x1bOH",
    }[functionalKey];
    if (appSequence) return { handled: true, sequence: appSequence };
  }

  if (modifierBits === 0) {
    if (!disambiguate && !reportAll && functionalKey === "Escape") {
      return { handled: true, sequence: "\x1b" };
    }
    if (legacyMode) {
      const functionSequence = {
        F1: "\x1bOP",
        F2: "\x1bOQ",
        F3: "\x1bOR",
        F4: "\x1bOS",
      }[functionalKey];
      if (functionSequence)
        return { handled: true, sequence: functionSequence };
    }
  }

  if (legacyMode && modifierBits !== 0) {
    const prefix = modifierBits & 2 ? "\x1b" : "";
    if (functionalKey === "Enter") {
      return { handled: true, sequence: `${prefix}\r` };
    }
    if (functionalKey === "Escape") {
      return { handled: true, sequence: `${prefix}\x1b` };
    }
    if (functionalKey === "Backspace") {
      return {
        handled: true,
        sequence: `${prefix}${modifierBits & 4 ? "\x08" : "\x7f"}`,
      };
    }
    if (functionalKey === "Tab") {
      if (modifierBits & 1) {
        return {
          handled: true,
          sequence: `${modifierBits & 2 ? "\x1b\x1b" : "\x1b"}[Z`,
        };
      }
      return { handled: true, sequence: `${prefix}\t` };
    }
  }

  if (
    nonLockModifiers === 0 &&
    !reportAll &&
    (functionalKey === "Enter" ||
      functionalKey === "Backspace" ||
      functionalKey === "Tab")
  ) {
    return {
      handled: true,
      sequence:
        action === "release"
          ? null
          : functionalKey === "Enter"
            ? "\r"
            : functionalKey === "Backspace"
              ? "\x7f"
              : "\t",
    };
  }

  return { handled: false, sequence: null };
}

export function encodeKittyKey(
  event: KittyKeyEvent,
  flags: number,
  action: KittyKeyAction,
  pressedModifiers?: ReadonlySet<string>,
  cursorKeysApp = false,
): string | null {
  if (flags === 0) return null;
  if (action === "release" && !(flags & KITTY_REPORT_EVENTS)) return null;

  const normalizeKeypad = !(flags & 1) && !(flags & KITTY_REPORT_ALL);
  const resolved = resolveKey(event, normalizeKeypad);
  const entry = resolved?.entry ?? null;
  const textEntry = printableEntry(event);

  const legacyText =
    !(flags & KITTY_REPORT_ALL) &&
    textEntry !== null &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey;

  const legacyModified =
    !(flags & 1) &&
    !(flags & KITTY_REPORT_ALL) &&
    (action === "press" || !(flags & KITTY_REPORT_EVENTS)) &&
    (event.ctrlKey || event.altKey)
      ? legacyModifiedText(event)
      : null;

  if (action === "release" && !(flags & KITTY_REPORT_ALL) && legacyText) {
    return null;
  }

  if (
    action !== "release" &&
    !(flags & KITTY_REPORT_ALL) &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    if (!event.shiftKey) {
      if (
        event.key === "Enter" &&
        (event.code !== "NumpadEnter" || normalizeKeypad)
      )
        return "\r";
      if (event.key === "Tab") return "\t";
      if (event.key === "Backspace") return "\x7f";
    }
    if (legacyText) return event.key;
  }
  if (legacyModified !== null) return legacyModified;

  if (!entry) return null;
  if (entry.modifier && !(flags & KITTY_REPORT_ALL)) return null;

  const modifiers = modifierValue(event, action, pressedModifiers);
  if (resolved?.functionalKey) {
    const legacy = legacyFunctionalSequence(
      resolved.functionalKey,
      flags,
      action,
      modifiers - 1,
      cursorKeysApp,
    );
    if (legacy.handled) return legacy.sequence;
  }
  const eventType =
    flags & KITTY_REPORT_EVENTS
      ? action === "repeat"
        ? 2
        : action === "release"
          ? 3
          : 0
      : 0;

  if (entry.final !== "u" && entry.final !== "~") {
    if (eventType !== 0) {
      return `\x1b[1;${modifiers}:${eventType}${entry.final}`;
    }
    if (modifiers > 1) return `\x1b[1;${modifiers}${entry.final}`;
    return `\x1b[${entry.final}`;
  }

  let sequence = `\x1b[${entry.code}`;
  if (textEntry && flags & KITTY_REPORT_ALTERNATES && event.shiftKey) {
    const shifted = codePoint(event.key);
    if (shifted !== null && shifted !== entry.code) sequence += `:${shifted}`;
  }

  let emittedModifiers = false;
  if (eventType === 2 || eventType === 3) {
    sequence += `;${modifiers}:${eventType}`;
    emittedModifiers = true;
  } else if (modifiers > 1) {
    sequence += `;${modifiers}`;
    emittedModifiers = true;
  }

  if (textEntry && flags & KITTY_REPORT_ASSOCIATED && action !== "release") {
    const text = associatedText(event);
    if (text.length > 0) {
      sequence += emittedModifiers ? ";" : ";;";
      sequence += text.join(":");
    }
  }

  return sequence + entry.final;
}
