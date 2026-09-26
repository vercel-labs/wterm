import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, value: string) {
  await page.evaluate((data) => {
    window.ptyHarness.replayWrite(data, 1);
  }, Buffer.from(value).toString("base64"));
  await page.evaluate(() => window.ptyHarness.frame());
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core} inverts the actual theme defaults, including partial and block cells`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.locator(".wterm").evaluate((el) => {
      el.style.setProperty("--term-fg", "#abcdef");
      el.style.setProperty("--term-bg", "#123456");
    });
    await write(
      page,
      "\x1b[?25l\x1b[7mreverse\r\n\x1b[31mpartial\r\n\x1b[39m█▀\x1b[0m",
    );
    const reverse = page
      .locator(".term-row > span")
      .filter({ hasText: /^reverse$/ });
    await expect(reverse).toHaveCSS("color", "rgb(18, 52, 86)");
    await expect(reverse).toHaveCSS("background-color", "rgb(171, 205, 239)");
    const partial = page
      .locator(".term-row > span")
      .filter({ hasText: /^partial$/ });
    await expect(partial).toHaveCSS("color", "rgb(18, 52, 86)");
    await expect(partial).not.toHaveCSS(
      "background-color",
      "rgb(171, 205, 239)",
    );
    const block = page.locator(".term-block").first();
    await expect(block).toHaveCSS("background-color", "rgb(18, 52, 86)");
  });
}

test("ghostty applies and resets application colors without replacing host theme variables", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  const root = page.locator(".wterm");
  await root.evaluate((el) => {
    el.style.setProperty("--term-fg", "#abcdef");
    el.style.setProperty("--term-bg", "#123456");
  });
  await write(
    page,
    "\x1b[?25lplain\r\n\x1b[7mreverse\x1b[0m\r\n\x1b[38;2;1;2;3;48;2;4;5;6mexplicit\x1b[0m",
  );
  const plain = page
    .locator(".term-row > span")
    .filter({ hasText: /^plain\s*$/ });
  const reverse = page
    .locator(".term-row > span")
    .filter({ hasText: /^reverse$/ });
  const explicit = page
    .locator(".term-row > span")
    .filter({ hasText: /^explicit$/ });
  await write(page, "\x1b]10;#fedcba\x07\x1b]11;#102030\x1b\\");
  await expect(root).toHaveCSS("background-color", "rgb(16, 32, 48)");
  await expect(plain).toHaveCSS("color", "rgb(254, 220, 186)");
  await expect(reverse).toHaveCSS("color", "rgb(16, 32, 48)");
  await expect(reverse).toHaveCSS("background-color", "rgb(254, 220, 186)");
  await expect(explicit).toHaveCSS("color", "rgb(1, 2, 3)");
  await expect(explicit).toHaveCSS("background-color", "rgb(4, 5, 6)");
  expect(
    await root.evaluate((el) => el.style.getPropertyValue("--term-fg")),
  ).toBe("#abcdef");
  await root.evaluate((el) => {
    el.style.setProperty("--term-fg", "#aabbcc");
    el.style.setProperty("--term-bg", "#ddeeff");
  });
  await expect(plain).toHaveCSS("color", "rgb(254, 220, 186)");
  await write(page, "\x1b]110\x07\x1b]111\x1b\\");
  await expect(plain).toHaveCSS("color", "rgb(170, 187, 204)");
  await expect(root).toHaveCSS("background-color", "rgb(221, 238, 255)");
  await expect(reverse).toHaveCSS("color", "rgb(221, 238, 255)");
  await expect(reverse).toHaveCSS("background-color", "rgb(170, 187, 204)");
});

test("ghostty cursor colors reach every cursor shape and reset to the current theme", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  const root = page.locator(".wterm");
  const cursor = page.locator(".term-cursor");
  await root.locator("textarea").focus();
  await write(page, "\x1b]11;#102030\x07\x1b]12;#fedcba\x07\x1b[2 q");
  await expect(cursor).toHaveCSS("background-color", "rgb(254, 220, 186)");
  await expect(cursor).toHaveCSS("color", "rgb(16, 32, 48)");
  for (const shape of [4, 6]) {
    await write(page, `\x1b[${shape} q`);
    expect(
      await cursor.evaluate((el) => getComputedStyle(el).boxShadow),
    ).toContain("rgb(254, 220, 186)");
  }
  await page.locator("#core").focus();
  await expect(cursor).toHaveCSS("outline-color", "rgb(254, 220, 186)");
  await root.evaluate((el) => el.style.setProperty("--term-cursor", "#123456"));
  await write(page, "\x1b]112\x07");
  await expect(cursor).toHaveCSS("outline-color", "rgb(18, 52, 86)");
});

test("ghostty paints colors atomically and defers paused panes until resumed", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  const root = page.locator(".wterm");
  const initial = await root.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await write(page, "\x1b[?2026h\x1b]11;#123456\x07");
  expect(
    await root.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(initial);
  await write(page, "\x1b[?2026l");
  await expect(root).toHaveCSS("background-color", "rgb(18, 52, 86)");
  await page.evaluate(() => window.ptyHarness.setRenderingPaused(true));
  await write(page, "\x1b]11;#654321\x07");
  expect(
    await root.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(18, 52, 86)");
  await page.evaluate(() => window.ptyHarness.setRenderingPaused(false));
  await expect(root).toHaveCSS("background-color", "rgb(101, 67, 33)");
  await page.evaluate(() => window.ptyHarness.close());
  await expect(root).toHaveCSS("background-color", initial);
});

test("ghostty recolors retained Unicode without replacing its selection", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(20, 3));
  await write(
    page,
    "\x1b[?25l\x1b[7mretained界e\u0301\x1b[0m\r\nsecond\r\nthird\r\nfourth",
  );
  const span = page
    .locator(".term-row > span")
    .filter({ hasText: /^retained$/ });
  await expect(span).toBeVisible();
  await page.evaluate(() => window.ptyHarness.selectLine(0));
  const selected = await page.evaluate(() => window.ptyHarness.selectionText());
  expect(selected).toBe("retained界e\u0301");
  await write(page, "\x1b]10;#aabbcc\x07\x1b]11;#123456\x07");
  await expect(span).toHaveCSS("color", "rgb(18, 52, 86)");
  await expect(span).toHaveCSS("background-color", "rgb(170, 187, 204)");
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    selected,
  );
});
