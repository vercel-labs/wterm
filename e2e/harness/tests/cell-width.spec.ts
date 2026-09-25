import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.evaluate((data) => {
    window.ptyHarness.replayWrite(data, 1);
  }, Buffer.from(text).toString("base64"));
  await page.evaluate(() => window.ptyHarness.frame());
}

async function borders(page: Page) {
  return page.locator(".term-row").evaluateAll((rows) =>
    rows.flatMap((row) => {
      const border = Array.from(row.querySelectorAll("span")).find(
        (span) => span.textContent === "│",
      );
      if (!border) return [];
      const { x, width } = border.getBoundingClientRect();
      return [{ x: x - row.getBoundingClientRect().x, width }];
    }),
  );
}

function expectColumn60(cells: { x: number; width: number }[]) {
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    expect(Math.abs(cell.x - 60 * cell.width)).toBeLessThan(0.1);
  }
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core} aligns fallback glyphs, wide cells, links, and cursors to the same columns`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(64, 8));
    const linked = "⣿".repeat(30) + "界".repeat(15);
    const prefixes = [
      "A".repeat(60),
      "⣿".repeat(60),
      "─".repeat(60),
      "𝄞".repeat(60),
      "界".repeat(30),
      `\x1b]8;;https://example.com\x1b\\\x1b[1;32m${linked}\x1b[0m\x1b]8;;\x1b\\`,
      ...(core === "ghostty" ? ["e\u0301".repeat(60)] : []),
    ];
    await write(
      page,
      prefixes.map((prefix) => `${prefix}\x1b[31m│\x1b[0m`).join("\r\n") +
        "\x1b[2;61H",
    );
    const rows = page.locator(".term-row");
    const cells = await borders(page);
    expect(cells).toHaveLength(prefixes.length);
    expectColumn60(cells);
    await expect(page.locator(".term-cursor")).toHaveText("│");
    // ASCII stays batched; fallback glyphs must also align inside each row.
    await expect(rows.nth(0).locator("span")).toHaveCount(3);
    const braille = rows.nth(1).locator("span").filter({ hasText: "⣿" });
    await expect(braille).toHaveCount(60);
    const positions = await braille.evaluateAll((spans) =>
      spans.map((span) => ({
        x: span.getBoundingClientRect().x - spans[0].getBoundingClientRect().x,
        width: span.getBoundingClientRect().width,
      })),
    );
    positions.forEach(({ x, width }, col) => {
      expect(Math.abs(x - col * cells[1].width)).toBeLessThan(0.1);
      expect(width).toBeCloseTo(cells[1].width, 2);
    });
    const link = rows.nth(5).locator("a");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(linked);
    expect(
      await link.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        const selected = selection.toString();
        selection.removeAllRanges();
        return selected;
      }),
    ).toBe(linked);
    // Force different glyph advances independently of the installed fonts.
    await rows.nth(1).evaluate((row) => {
      row.style.fontSize = "28px";
    });
    expectColumn60(await borders(page));
    // Moving the cursor splits an ASCII run without changing its total width.
    await write(page, "\x1b[1;31H");
    expectColumn60(await borders(page));
  });

  test(`${core} keeps scrollback aligned through resize and font changes`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(64, 4));
    await write(
      page,
      "\x1b[?25l" + ("⣿".repeat(60) + "\x1b[31m│\x1b[0m\r\n").repeat(6),
    );
    expect(await page.locator(".term-scrollback-row").count()).toBeGreaterThan(
      0,
    );
    expectColumn60(await borders(page));
    await page.evaluate(() => window.ptyHarness.resize(63, 4));
    await page.evaluate(() => window.ptyHarness.frame());
    expectColumn60(await borders(page));
    const oldWidth = (await borders(page))[0].width;
    await page.locator(".wterm").evaluate((el) => {
      el.style.setProperty("--term-font-size", "21px");
    });
    await expect
      .poll(async () => (await borders(page))[0].width)
      .toBeGreaterThan(oldWidth * 1.4);
    expectColumn60(await borders(page));
    expect(
      await page.evaluate(() => window.ptyHarness.report().terminal),
    ).toEqual({ cols: 63, rows: 4 });
  });

  test(`${core} refits columns when the font changes in a fixed-size container`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay&autoResize=true`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.locator(".wterm").evaluate((el) => {
      el.style.width = "900px";
      el.style.height = "136px";
    });
    await expect
      .poll(() => page.evaluate(() => window.ptyHarness.snapshot().cols))
      .toBeGreaterThan(90);
    const before = await page.evaluate(() => window.ptyHarness.snapshot().cols);
    await page.locator(".wterm").evaluate((el) => {
      el.style.setProperty("--term-font-size", "28px");
    });
    await expect
      .poll(() => page.evaluate(() => window.ptyHarness.snapshot().cols))
      .toBeLessThan(before * 0.6);
    const result = await page.locator(".wterm").evaluate((el) => ({
      cols: window.ptyHarness.snapshot().cols,
      width: parseFloat(
        getComputedStyle(el).getPropertyValue("--term-cell-width"),
      ),
    }));
    expect(result.cols).toBe(Math.floor(900 / result.width));
  });
}
