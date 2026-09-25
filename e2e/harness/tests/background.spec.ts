import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, value: string) {
  await page.evaluate((data) => {
    window.ptyHarness.replayWrite(data, 1);
  }, Buffer.from(value).toString("base64"));
  await page.evaluate(() => window.ptyHarness.frame());
}

// Sample the actual painted background, including transparent ancestors and
// shadows. Computed cell colors alone cannot detect a row or grid bleeding
// through a transparent cell. PNG decoding uses the browser, not a dependency.
async function expectBackgrounds(
  page: Page,
  samples: { row: number; col?: number; tail?: boolean; color: string }[],
) {
  const grid = page.locator(".term-grid");
  const points = await grid.evaluate((el, samples) => {
    const rect = el.getBoundingClientRect();
    const rows = el.querySelectorAll(".term-row");
    const cols = window.ptyHarness.snapshot().cols;
    return samples.map(({ row, col = 0, tail, color }) => {
      const rowEl = rows[row];
      const rowRect = rowEl.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(rowEl);
      const cellsRect = range.getBoundingClientRect();
      const cellWidth = cellsRect.width / cols;
      return {
        x: Math.floor(tail ? rect.width - 4 : (col + 0.5) * cellWidth),
        // Above the glyphs, so font rasterization does not affect the sample.
        y: Math.ceil(rowRect.top - rect.top) + 1,
        color,
      };
    });
  }, samples);
  const png = await grid.screenshot({ scale: "css" });
  const pixels = await page.evaluate(
    async ({ png, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return points.map(({ x, y, color }) => {
        const [r, g, b] = context.getImageData(x, y, 1, 1).data;
        return { expected: color, actual: `rgb(${r}, ${g}, ${b})` };
      });
    },
    { png: png.toString("base64"), points },
  );
  for (const [index, pixel] of pixels.entries()) {
    expect(pixel.actual, JSON.stringify(samples[index])).toBe(pixel.expected);
  }
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core} confines edge-cell backgrounds and preserves full-width status bars`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(20, 4));
    await write(
      page,
      "\x1b[?25l" +
        "a".repeat(19) +
        "\x1b[7m \x1b[0m\r\n" +
        "b".repeat(19) +
        "\x1b[41m \x1b[0m\r\n" +
        "\x1b[41m" +
        " ".repeat(20) +
        "\x1b[0m\r\n" +
        "c".repeat(19) +
        "\x1b[41m \x1b[0m",
    );
    const rows = page.locator(".term-row");
    const background = await page
      .locator(".wterm")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const red = await rows
      .nth(1)
      .locator("span")
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const reversed = await rows
      .nth(0)
      .locator("span")
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await expectBackgrounds(page, [
      { row: 0, color: background },
      { row: 0, col: 19, color: reversed },
      { row: 0, tail: true, color: background },
      { row: 1, color: background },
      { row: 1, col: 19, color: red },
      { row: 2, color: red },
      { row: 2, tail: true, color: red },
      { row: 3, color: background },
      { row: 3, col: 19, color: red },
    ]);

    // Updating a different cell must clear a formerly uniform row, even
    // though its last cell and the bottom-right cell did not change.
    await write(page, "\x1b[3;1H\x1b[0mX");
    await expectBackgrounds(page, [
      { row: 2, color: background },
      { row: 2, col: 19, color: red },
      { row: 2, tail: true, color: background },
    ]);
  });

  test(`${core} preserves history backgrounds across screen changes and resize`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(20, 3));
    await write(
      page,
      "\x1b[?25l" + "h".repeat(19) + "\x1b[44m \x1b[0m\r\n\r\n\r\n",
    );
    await expect(page.locator(".term-scrollback-row")).toHaveCount(1);
    const background = await page
      .locator(".wterm")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await write(page, "\x1b[41m\x1b[2J");
    const blue = await page
      .locator(".term-scrollback-row span")
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await expectBackgrounds(page, [
      { row: 0, color: background },
      { row: 0, col: 19, color: blue },
      { row: 0, tail: true, color: background },
    ]);

    await write(page, "\x1b[?1049h\x1b[44m\x1b[2J\x1b[?1049l\x1b[0m");
    await page.evaluate(() => window.ptyHarness.resize(24, 3));
    await page.evaluate(() => window.ptyHarness.frame());
    await expectBackgrounds(page, [
      { row: 0, color: background },
      { row: 0, col: 19, color: blue },
      { row: 0, col: 23, color: background },
      { row: 0, tail: true, color: background },
    ]);
  });
}
