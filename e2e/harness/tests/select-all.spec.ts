import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.evaluate(
    (data) => window.ptyHarness.replayWrite(data, 4096),
    Buffer.from(text).toString("base64"),
  );
  await page.evaluate(() => window.ptyHarness.frame());
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: Select All copies unmounted history without growing the DOM`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    const lines = Array.from(
      { length: 1500 },
      (_, i) => `line ${String(i).padStart(4, "0")} 界😀`,
    );
    await write(page, lines.join("\r\n"));
    const retained = await page.evaluate(() => {
      const snapshot = window.ptyHarness.snapshot();
      return snapshot.scrollbackCount + snapshot.height;
    });
    expect(retained).toBeGreaterThan(500);
    const expected = lines.slice(-retained).join("\n");
    const mounted = await page.locator(".term-row").count();
    expect(mounted).toBeLessThan(100);
    // Both terminal shortcuts use the complete buffer; Ctrl+A remains shell input.
    for (const shortcut of ["Meta+a", "Control+Shift+A"]) {
      await page.keyboard.press(shortcut);
      await expect(page.locator("#terminal")).toHaveClass(/term-select-all/);
      expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
        expected,
      );
      expect(await page.locator(".term-row").count()).toBeLessThan(100);
      await page.locator("#terminal").evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event("scroll"));
      });
      await page.evaluate(() => window.ptyHarness.frame());
      expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
        expected,
      );
      expect(await page.locator(".term-row").count()).toBeLessThan(100);
      expect(
        await page
          .locator(".term-row")
          .first()
          .evaluate((row) => getComputedStyle(row, "::after").content),
      ).toBe('""');
    }
    // Use real Copy/Paste, without granting programmatic clipboard permissions.
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+c" : "Control+c",
    );
    await page.evaluate(() => {
      const input = document.createElement("textarea");
      input.id = "copy-target";
      document.body.appendChild(input);
      input.focus();
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+v" : "Control+v",
    );
    await expect(page.locator("#copy-target")).toHaveValue(expected);
    expect(
      await page.evaluate(() => window.ptyHarness.selectionText()),
    ).toBeNull();
  });
}

test("Ghostty: all-history copy joins Unicode wraps and excludes inactive screens", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(6, 4));
  await write(page, "abcde界e\u0301😀xyz\r\n\r\nlast");
  expect(await page.evaluate(() => window.ptyHarness.selectAll())).toBe(true);
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    "abcde界e\u0301😀xyz\n\nlast",
  );
  await write(page, "\x1b[?1049h\x1b[2J\x1b[Halt");
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).toBeNull();
  expect(await page.evaluate(() => window.ptyHarness.selectAll())).toBe(true);
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    "alt\n\n\n",
  );
  await write(page, "\x1b[?1049l");
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).toBeNull();
});

test("selection cancels on Escape, input, resize and pending output", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(page, "chosen");
  for (const key of ["Escape", "x", "Control+a"]) {
    expect(await page.evaluate(() => window.ptyHarness.selectAll())).toBe(true);
    await page.keyboard.press(key);
    await expect(page.locator("#terminal")).not.toHaveClass(/term-select-all/);
    expect(
      await page.evaluate(() => window.ptyHarness.selectionText()),
    ).toBeNull();
  }
  expect(await page.evaluate(() => window.ptyHarness.selectAll())).toBe(true);
  await page.evaluate(() => window.ptyHarness.resize(30, 8));
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).toBeNull();
  expect(
    await page.evaluate(async () => {
      const result = window.ptyHarness.selectAll();
      window.ptyHarness.replayWrite(btoa("new"), 10);
      return result;
    }),
  ).toBe(false);
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).toBeNull();
});

test("Ctrl+Shift+C copies Select All with Kitty modifier reporting enabled", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(20, 2));
  await write(page, "copy this\x1b[>31u");
  await page.keyboard.press("Control+Shift+A");
  await expect(page.locator("#terminal")).toHaveClass(/term-select-all/);
  await page.keyboard.press("Control+Shift+C");
  await expect(page.locator("#terminal")).toHaveClass(/term-select-all/);
  await page.evaluate(() => {
    const input = document.createElement("textarea");
    input.id = "copy-target";
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+v" : "Control+v",
  );
  await expect(page.locator("#copy-target")).toHaveValue("copy this\n");
  const responses = await page.evaluate(
    () => window.ptyHarness.snapshot().responses,
  );
  expect(responses.some((text) => /\x1b\[(97|99)[;u]/.test(text))).toBe(false);
});
