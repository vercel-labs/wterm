import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHORTCUTS,
  bindingError,
  conflictingCommand,
  eventBinding,
  matchCommand,
  readShortcuts,
} from "../lib/shortcuts";

const event = (options: Partial<KeyboardEvent> = {}) =>
  ({
    code: "KeyG",
    key: "g",
    ctrlKey: true,
    shiftKey: true,
    getModifierState: () => false,
    ...options,
  }) as KeyboardEvent;

test("shortcut preferences accept supported bindings, clearing, and partial defaults", () => {
  const custom = readShortcuts(
    '{"find":["Control+Shift+KeyG"],"left":[],"unknown":["junk"]}',
  );
  assert.deepEqual(custom.find, ["Control+Shift+KeyG"]);
  assert.deepEqual(custom.left, []);
  assert.deepEqual(custom.right, DEFAULT_SHORTCUTS.right);
  assert.deepEqual(
    readShortcuts(JSON.stringify(DEFAULT_SHORTCUTS)),
    DEFAULT_SHORTCUTS,
  );
});

test("invalid, ambiguous, oversized, and reserved stored bindings fall back to defaults", () => {
  for (const value of [
    null,
    "{",
    "[]",
    '"value"',
    " ".repeat(8193),
    '{"new":"Control+Enter"}',
    '{"find":["Control+Control+KeyG"]}',
    '{"find":["Shift+Control+KeyG"]}',
    '{"find":["Control+KeyC"]}',
    '{"new":["Meta+KeyF"]}',
    '{"new":["Control+Enter","Control+Enter"]}',
    '{"new":[null]}',
  ])
    assert.deepEqual(readShortcuts(value), DEFAULT_SHORTCUTS);
});

test("recording protects bare keys, AltGr text, browser actions, and clipboard combinations", () => {
  for (const binding of [
    "KeyA",
    "Shift+KeyG",
    "Control+Alt+KeyG",
    "Control+Alt+Space",
    "Control+Shift+KeyV",
    "Meta+KeyC",
    "Meta+KeyW",
    "Control+KeyD",
    "Control+KeyR",
    "Meta+Tab",
    "Control+F5",
    "Meta+KeyQ",
  ])
    assert.ok(bindingError(binding), binding);
  for (const binding of [
    "Control+Shift+Enter",
    "Control+Shift+KeyG",
    "Meta+Alt+ArrowLeft",
  ])
    assert.equal(bindingError(binding), null);
  assert.equal(
    conflictingCommand(DEFAULT_SHORTCUTS, "new", "Meta+KeyF"),
    "find",
  );
  assert.equal(
    conflictingCommand(DEFAULT_SHORTCUTS, "find", "Meta+KeyF"),
    undefined,
  );
});

test("matching uses exact modifiers and physical positions, excluding IME and AltGr", () => {
  const shortcuts = { ...DEFAULT_SHORTCUTS, find: ["Control+Shift+KeyG"] };
  assert.equal(matchCommand(shortcuts, event({ key: "ж" })), "find");
  for (const options of [
    { altKey: true },
    { metaKey: true },
    { shiftKey: false },
    { isComposing: true },
    { keyCode: 229 },
    { key: "Dead" },
    { key: "Process" },
    { getModifierState: () => true },
  ])
    assert.equal(matchCommand(shortcuts, event(options)), undefined);
  assert.equal(
    eventBinding(event({ code: "ControlLeft", key: "Control" })),
    null,
  );
});
