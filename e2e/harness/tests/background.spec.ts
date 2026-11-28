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
  samples: {
    row: number;
    col?: number;
    tail?: boolean;
    bottom?: boolean;
    color: string;
  }[],
) {
  const grid = page.locator(".term-grid");
  const points = await grid.evaluate((el, samples) => {
    const rect = el.getBoundingClientRect();
    const rows = el.querySelectorAll(".term-row");
    const cols = window.ptyHarness.snapshot().cols;
    return samples.map(({ row, col = 0, tail, bottom, color }) => {
      const rowEl = rows[row];
      const rowRect = rowEl.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(rowEl);
      const cellsRect = range.getBoundingClientRect();
      const cellWidth = cellsRect.width / cols;
      return {
        x: Math.floor(tail ? rect.width - 4 : (col + 0.5) * cellWidth),
        // Above the glyphs, so font rasterization does not affect the sample.
        y: bottom
          ? Math.floor(rowRect.bottom - rect.top) - 2
          : Math.ceil(rowRect.top - rect.top) + 1,
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

/** Returns the core-resolved RGB background of a cell, or null when the theme supplies it. */
async function coreBackground(page: Page, row: number, col: number) {
  return page.evaluate(
    ([row, col]) => {
      const rgb = window.ptyHarness.snapshot().cells[row][col].bgRgb;
      return rgb === undefined
        ? null
        : `rgb(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255})`;
    },
    [row, col],
  );
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
    const red =
      (await coreBackground(page, 1, 19)) ??
      (await rows
        .nth(1)
        .locator("span")
        .last()
        .evaluate((el) => getComputedStyle(el).backgroundColor));
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

  test(`${core} paints truecolor block characters on the cell canvas`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(20, 3));
    await write(
      page,
      "\x1b[?25l\x1b[38;2;255;0;0;48;2;0;0;255m▀\x1b[38;2;0;255;0m█\x1b[0m",
    );
    await expect(page.locator(".term-cell-canvas")).toBeVisible();
    await expect(page.locator(".term-canvas-run")).toHaveText("▀█");
    await expectBackgrounds(page, [
      { row: 0, col: 0, color: "rgb(255, 0, 0)" },
      { row: 0, col: 0, bottom: true, color: "rgb(0, 0, 255)" },
      { row: 0, col: 1, color: "rgb(0, 255, 0)" },
      { row: 0, col: 1, bottom: true, color: "rgb(0, 255, 0)" },
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

test.describe("at device pixel ratio 2", () => {
  test.use({ deviceScaleFactor: 2 });

  // Each pattern is orange across the top quarter of its row: ▛ and █ fill
  // the top half, and ▐ ▌ ▂ are drawn orange on orange.
  const seamCases = [
    { blocks: "quadrants", pattern: "▛█".repeat(8), bg: "0;0;0" },
    {
      blocks: "half and lower-quarter blocks",
      pattern: "▐█▌█▂█".repeat(3),
      bg: "215;119;87",
    },
  ];
  for (const core of ["builtin", "ghostty"]) {
    for (const { blocks, pattern, bg } of seamCases)
      test(`${core} leaves no seam between ${blocks} and full blocks at a fractional cell width`, async ({
        page,
      }) => {
        await page.goto(`/?core=${core}&mode=replay`);
        await expect(page.locator("#status")).toHaveText("Replay ready");
        await page.evaluate(() => window.ptyHarness.resize(20, 3));
        await write(
          page,
          `\x1b[?25l\x1b[38;2;215;119;87;48;2;${bg}m${pattern}\x1b[0m`,
        );
        const grid = page.locator(".term-grid");
        await expect(grid.locator(".term-row").first()).toContainText(pattern);
        const span = await grid.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const row = el.querySelector(".term-row")!.getBoundingClientRect();
          const width = parseFloat(
            getComputedStyle(el).getPropertyValue("--term-cell-width"),
          );
          return {
            width,
            left: row.left - rect.left,
            y: row.top - rect.top + row.height / 4,
          };
        });
        expect(Number.isInteger(span.width * 2)).toBe(false);
        const png = await grid.screenshot({ scale: "device" });
        const seams = await page.evaluate(
          async ({ png, span, cols }) => {
            const image = new Image();
            image.src = `data:image/png;base64,${png}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            const from = Math.ceil(span.left * 2);
            const to = Math.floor((span.left + cols * span.width) * 2);
            const { data } = context.getImageData(
              from,
              Math.floor(span.y * 2),
              to - from,
              1,
            );
            // Off by more than WebKit's colour conversion: a seam.
            const off = new Set<string>();
            for (let i = 0; i < data.length; i += 4)
              if (
                Math.abs(data[i] - 215) > 2 ||
                Math.abs(data[i + 1] - 119) > 2 ||
                Math.abs(data[i + 2] - 87) > 2
              )
                off.add(
                  `${from + i / 4}: rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`,
                );
            return [...off];
          },
          { png: png.toString("base64"), span, cols: pattern.length },
        );
        expect(seams).toEqual([]);
      });

    for (const offset of [0.25, 0.5]) {
      test(`${core} leaves no line between a canvas row and a quadrant row ${offset}px off the pixel grid`, async ({
        page,
      }) => {
        await page.goto(`/?core=${core}&mode=replay`);
        await expect(page.locator("#status")).toHaveText("Replay ready");
        await page.evaluate(() => window.ptyHarness.resize(20, 3));
        const terminal = page.locator("#terminal");
        const margin = await terminal.evaluate((el) =>
          parseFloat(getComputedStyle(el).marginTop),
        );
        await terminal.evaluate(
          (el, top) => (el.style.marginTop = `${top}px`),
          Math.floor(margin) + offset,
        );
        // Every row is orange where the scans cross it: █, then ▛ (left
        // half) or █ in the row that stays out of the canvas, then the top
        // half of ▀.
        await write(
          page,
          "\x1b[?25l\x1b[38;2;215;119;87;48;2;0;0;0m" +
            "█".repeat(20) +
            "\r\n▛▀" +
            "█".repeat(18) +
            "\r\n" +
            "▀".repeat(20) +
            "\x1b[0m",
        );
        const grid = page.locator(".term-grid");
        await expect(grid.locator(".term-row").nth(1)).toContainText("▛▀");
        const box = await grid.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const rows = el.querySelectorAll(".term-row");
          const first = rows[0].getBoundingClientRect();
          const last = rows[2].getBoundingClientRect();
          const width = parseFloat(
            getComputedStyle(el).getPropertyValue("--term-cell-width"),
          );
          return {
            xs: [0.25, 10.5].map((col) => first.left - rect.left + col * width),
            top: first.top - rect.top + first.height / 2,
            bottom: last.top - rect.top + last.height / 4,
          };
        });
        const png = await grid.screenshot({ scale: "device" });
        const lines = await page.evaluate(
          async ({ png, box }) => {
            const image = new Image();
            image.src = `data:image/png;base64,${png}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            const from = Math.ceil(box.top * 2);
            const off: string[] = [];
            for (const x of box.xs.map((x) => Math.floor(x * 2))) {
              const { data } = context.getImageData(
                x,
                from,
                1,
                Math.floor(box.bottom * 2) - from,
              );
              for (let i = 0; i < data.length; i += 4)
                if (
                  Math.abs(data[i] - 215) > 2 ||
                  Math.abs(data[i + 1] - 119) > 2 ||
                  Math.abs(data[i + 2] - 87) > 2
                )
                  off.push(
                    `${x},${from + i / 4}: rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`,
                  );
            }
            return off;
          },
          { png: png.toString("base64"), box },
        );
        expect(lines).toEqual([]);
      });
    }
  }
});
