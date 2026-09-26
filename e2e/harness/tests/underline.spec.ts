import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, value: string) {
  await page.evaluate(
    (data) => window.ptyHarness.replayWrite(data, 1),
    Buffer.from(value).toString("base64"),
  );
  await page.evaluate(() => window.ptyHarness.frame());
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core} keeps ordinary underlines and strikes independent`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await write(page, "\x1b[?25l\x1b[4;9munderlined\x1b[0m plain");
    const cell = page
      .locator(".term-row")
      .first()
      .locator(":scope > span")
      .first();
    await expect(cell).toHaveCSS("text-decoration-line", "underline");
    await expect(cell.locator("span")).toHaveCSS(
      "text-decoration-line",
      "line-through",
    );
    await expect(cell.locator("span")).toHaveCSS(
      "text-decoration-style",
      "solid",
    );
    await page.evaluate(() => window.ptyHarness.selectLine(0));
    expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
      "underlined plain",
    );
  });
}

test("ghostty renders underline variants, colors, resets, and unchanged text selection", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(
    page,
    "\x1b[?25l" +
      [1, 2, 3, 4, 5]
        .map((style) => `\x1b[4:${style};58;2;255;0;0mstyle${style} `)
        .join("") +
      "\x1b[59mdefault\x1b[24m plain",
  );
  const row = page.locator(".term-row").first();
  const spans = row.locator(":scope > span");
  for (const [index, style] of [
    "solid",
    "double",
    "wavy",
    "dotted",
    "dashed",
  ].entries()) {
    await expect(spans.nth(index)).toHaveCSS("text-decoration-style", style);
    await expect(spans.nth(index)).toHaveCSS(
      "text-decoration-color",
      "rgb(255, 0, 0)",
    );
    await expect(spans.nth(index)).toHaveCSS(
      "text-decoration-skip-ink",
      "none",
    );
  }
  const fg = await spans.nth(5).evaluate((el) => getComputedStyle(el).color);
  await expect(spans.nth(5)).toHaveCSS("text-decoration-color", fg);
  await expect(spans.nth(6)).toHaveCSS("text-decoration-line", "none");
  await row.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await write(page, "\r\nother output");
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    "style1 style2 style3 style4 style5 default plain",
  );
  await write(page, "\x1b[H\x1b[4:3;58;2;0;0;0mstyle1");
  await expect(spans.first()).toHaveCSS("text-decoration-style", "wavy");
  await expect(spans.first()).toHaveCSS(
    "text-decoration-color",
    "rgb(0, 0, 0)",
  );
});

test("ghostty preserves decorated Unicode, links, strikes, and geometry in history", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(20, 3));
  await write(
    page,
    "\x1b[?25l\x1b]8;;https://example.com\x1b\\\x1b[38;2;0;255;0;4:3;9;58;2;255;0;0mA界e\u0301█╭\x1b]8;;\x1b\\\x1b[0m\r\nline2\r\nline3\r\nline4",
  );
  const row = page.locator(".term-scrollback-row").first();
  await expect(row).toContainText("A界e\u0301█╭");
  const spans = row.locator(".term-link > span");
  await expect(spans).toHaveCount(5);
  for (let index = 0; index < 5; index++) {
    await expect(spans.nth(index)).toHaveCSS("text-decoration-style", "wavy");
    await expect(spans.nth(index)).toHaveCSS(
      "text-decoration-color",
      "rgb(255, 0, 0)",
    );
    const strike = spans.nth(index).locator("span");
    await expect(strike).toHaveCSS("text-decoration-style", "solid");
    await expect(strike).toHaveCSS("text-decoration-color", "rgb(0, 255, 0)");
  }
  const widths = await spans.evaluateAll((elements) =>
    elements.map((el) => el.getBoundingClientRect().width),
  );
  expect(widths[1]).toBeCloseTo(widths[0] * 2, 1);
  for (const width of widths.slice(2)) expect(width).toBeCloseTo(widths[0], 1);
  await page.evaluate(() => window.ptyHarness.selectLine(0));
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    "A界e\u0301█╭",
  );
  await page.evaluate(() => window.ptyHarness.clearSelection());
  await page.evaluate(() => window.ptyHarness.resize(10, 3));
  await page.evaluate(() => window.ptyHarness.frame());
  await expect(
    page.locator(".term-scrollback-row .term-wide").first(),
  ).toHaveCSS("text-decoration-style", "wavy");
});

test("ghostty underline colors follow inverse text and remain independent under the cursor", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.locator(".wterm textarea").focus();
  await write(
    page,
    "\x1b[38;2;0;255;0;48;2;0;0;255;7;4:3mA\x1b[58;2;255;0;0m界\x1b[0m\r\x1b[6 q",
  );
  const cursor = page.locator(".term-cursor");
  await expect(cursor).toHaveText("A");
  await expect(cursor).toHaveCSS("text-decoration-color", "rgb(0, 0, 255)");
  await expect(page.locator(".term-wide")).toHaveCSS(
    "text-decoration-color",
    "rgb(255, 0, 0)",
  );
  await write(page, "\x1b[1C\x1b[2 q");
  await expect(cursor).toHaveText("界");
  await expect(cursor).toHaveCSS("text-decoration-style", "wavy");
  await expect(cursor).toHaveCSS("text-decoration-color", "rgb(255, 0, 0)");
});
