import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPEARANCE, readAppearance } from "../lib/appearance";

test("stored appearance accepts only supported choices and bounded integer sizes", () => {
  for (const value of [
    null,
    "{",
    "null",
    "[]",
    '"light"',
    '{"theme":"unknown","fontSize":999}',
    '{"theme":{},"fontSize":"18"}',
  ])
    assert.deepEqual(readAppearance(value), DEFAULT_APPEARANCE);
  assert.deepEqual(
    readAppearance(
      '{"theme":"light","fontSize":18,"session":"not-a-preference"}',
    ),
    { theme: "light", fontSize: 18 },
  );
  assert.deepEqual(readAppearance('{"theme":"dark","fontSize":14.5}'), {
    theme: "dark",
    fontSize: 14,
  });
});
