import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.evaluate(
    (data) => window.ptyHarness.replayWrite(data, 4096),
    Buffer.from(text).toString("base64"),
  );
}
async function search(page: Page, query: string, count: number) {
  await page.evaluate((query) => window.ptyHarness.search(query), query);
  await expect
    .poll(() => page.evaluate(() => window.ptyHarness.searchState()))
    .toMatchObject({ count, searching: false });
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: finds unmounted history, navigates and preserves selectable text`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await write(
      page,
      "needle first\r\n" + "ordinary output\r\n".repeat(400) + "needle last",
    );
    await page.evaluate(() => window.ptyHarness.frame());
    await expect(
      page.locator(".term-row").filter({ hasText: "needle first" }),
    ).toHaveCount(0);
    await search(page, "needle", 2);
    await expect(page.locator(".term-search-active")).toBeVisible();
    await expect(
      page.locator(".term-row").filter({ hasText: "needle first" }),
    ).toBeVisible();
    const firstTop = await page
      .locator("#terminal")
      .evaluate((el) => el.scrollTop);
    // An overlay must leave the existing text nodes and native selection intact.
    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll(".term-row")).find(
        (el) => el.textContent?.includes("needle first"),
      )!;
      const range = document.createRange();
      range.selectNodeContents(row);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await page.evaluate(() => window.ptyHarness.findNext());
    await expect
      .poll(() => page.locator("#terminal").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(firstTop);
    await expect(page.locator(".term-search-active")).toBeVisible();
    expect(
      await page.evaluate(() => window.getSelection()?.toString()),
    ).toContain("needle first");
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      window.ptyHarness.findNext();
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.ptyHarness.searchState().activeIndex),
      )
      .toBe(0);
    await page.evaluate(() => window.ptyHarness.clearSearch());
    await expect(page.locator(".term-search-match")).toHaveCount(0);
  });
}

test("Ghostty: wrapped Unicode highlights survive reflow and output changes", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(6, 4));
  await write(page, "abcde界😀e\u0301");
  await search(page, "de界😀", 1);
  await expect(page.locator(".term-search-active")).toHaveCount(2);
  const bounds = await page
    .locator(".term-search-active")
    .evaluateAll((marks) =>
      marks.map((mark) => ({
        left: parseFloat((mark as HTMLElement).style.left),
        width: parseFloat((mark as HTMLElement).style.width),
      })),
    );
  const cellWidth = await page
    .locator("#terminal")
    .evaluate((el) =>
      parseFloat(getComputedStyle(el).getPropertyValue("--term-cell-width")),
    );
  expect(bounds[0].left).toBeCloseTo(3 * cellWidth, 1);
  expect(bounds[0].width).toBeCloseTo(2 * cellWidth, 1);
  expect(bounds[1].width).toBeCloseTo(4 * cellWidth, 1);
  await page.evaluate(() => window.ptyHarness.resize(20, 4));
  await expect
    .poll(() => page.evaluate(() => window.ptyHarness.searchState()))
    .toMatchObject({ count: 1, searching: false });
  await expect(page.locator(".term-search-active")).toHaveCount(1);
  await write(page, "\x1b[?1049h");
  await expect
    .poll(() => page.evaluate(() => window.ptyHarness.searchState()))
    .toMatchObject({ count: 0, searching: false });
  await expect(page.locator(".term-search-match")).toHaveCount(0);
  await write(page, "\x1b[?1049l");
  await expect
    .poll(() => page.evaluate(() => window.ptyHarness.searchState()))
    .toMatchObject({ count: 1, searching: false });
});

test("search cancels stale scans and waits for synchronized output", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(page, "target\r\n".repeat(2000));
  await page.evaluate(() => {
    window.ptyHarness.search("target");
    window.ptyHarness.search("missing");
  });
  await expect
    .poll(() => page.evaluate(() => window.ptyHarness.searchState()))
    .toMatchObject({ query: "missing", count: 0, searching: false });
  await write(page, "\x1b[?2026hheld");
  await page.evaluate(() => window.ptyHarness.search("held"));
  await page.evaluate(() => window.ptyHarness.frame());
  expect(
    await page.evaluate(() => window.ptyHarness.searchState()),
  ).toMatchObject({ count: 0, searching: true });
  await write(page, "\x1b[?2026l");
  await expect
    .poll(() => page.evaluate(() => window.ptyHarness.searchState()))
    .toMatchObject({ count: 1, searching: false });
  await page.evaluate(() => {
    window.ptyHarness.search("target");
    window.ptyHarness.close();
  });
  await expect(page.locator(".term-search-layer")).toHaveCount(0);
});
