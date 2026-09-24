import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { chromium, firefox, webkit } from "@playwright/test";

const source = await readFile(
  new URL("public-api.mjs", import.meta.url),
  "utf8",
);
const bytes = await readFile(new URL("dist/ghostty-vt.wasm", import.meta.url));
const wasm = bytes.toString("base64");
const build = JSON.parse(
  await readFile(new URL("dist/build.json", import.meta.url)),
);
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  build.artifact.sha256,
);
const results = [];

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  test(`${name}: public ABI callbacks, memory growth, render state, and snapshots`, async () => {
    const result = { browser: name, passed: false };
    results.push(result);
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      // A fresh blank page, with no server or application integration. This
      // checks the binding's Wasm/JS behavior, not DOM-renderer performance.
      await page.addScriptTag({
        type: "module",
        content: `${source}\nwindow.PublicApi = PublicApi;`,
      });
      const actual = await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const api = await window.PublicApi.load(bytes);
        const term = api.terminal(20, 4);
        let restored;
        try {
          term.write("\x1b[?2027h\x1b[1;38;2;12;34;56me\u0301界👩‍💻\x1b[6n\x07");
          api.exports.memory.grow(1);
          const frame = term.render();
          term.resize(30, 6);
          term.write("\x1b[38;2;90;");
          restored = api.restore(term.snapshot());
          restored.write("80;70mZ");
          const resumed = restored.render();
          return {
            text: frame.grid[0].text,
            color: frame.grid[0].cells[0].style.fg_color.value.rgb,
            effects: term.effects,
            restoredText: resumed.grid[0].text,
            restoredColor: resumed.grid[0].cells[5].style.fg_color.value.rgb,
            size: [resumed.cols, resumed.rows],
            instantiateMs: api.instantiateMs,
          };
        } finally {
          restored?.dispose();
          term.dispose();
        }
      }, wasm);
      assert.equal(actual.text, "e\u0301界👩‍💻");
      assert.deepEqual(actual.color, { r: 12, g: 34, b: 56 });
      assert.deepEqual(actual.effects, [
        { type: "reply", data: "\x1b[1;6R" },
        { type: "bell" },
      ]);
      assert.equal(actual.restoredText, "e\u0301界👩‍💻Z");
      assert.deepEqual(actual.restoredColor, { r: 90, g: 80, b: 70 });
      assert.deepEqual(actual.size, [30, 6]);
      Object.assign(result, actual, {
        version: browser.version(),
        passed: true,
      });
    } finally {
      await browser.close();
    }
  });
}

after(async () => {
  await writeFile(
    new URL("dist/browsers.json", import.meta.url),
    JSON.stringify({ ...build, results }, null, 2) + "\n",
  );
});
