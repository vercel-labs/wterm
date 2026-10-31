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
  test(`${core} paints glyph overhang without changing adjacent cell positions`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(30, 4));
    await write(page, "\x1b[?25l     \x1b[1mW\x1b[0m         \x1b[31mX");
    const grid = page.locator(".term-grid");
    const state = await grid.evaluate((element) => {
      const spans = Array.from(
        element
          .querySelector(".term-row")!
          .querySelectorAll<HTMLElement>("span"),
      );
      const glyph = spans.find((span) => span.textContent === "W")!;
      const next = glyph.nextElementSibling as HTMLElement;
      // Force ink beyond one cell independently of installed fallback fonts.
      glyph.style.fontSize = "32px";
      glyph.style.fontFamily = "monospace";
      glyph.style.color = "rgb(255,255,255)";
      const r = glyph.getBoundingClientRect(),
        g = element.getBoundingClientRect();
      return {
        right: r.right - g.x,
        top: r.top - g.y,
        bottom: r.bottom - g.y,
        next: next.getBoundingClientRect().x,
        width: r.width,
      };
    });
    const png = await grid.screenshot({ scale: "css" });
    const ink = await page.evaluate(
      async ({ png, state }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        let bright = 0;
        for (
          let x = Math.ceil(state.right) + 1;
          x < Math.ceil(state.right) + 5;
          x++
        )
          for (let y = Math.ceil(state.top); y < state.bottom; y++) {
            const pixel = ctx.getImageData(x, y, 1, 1).data;
            if (pixel[0] > 150 && pixel[1] > 150 && pixel[2] > 150) bright++;
          }
        return bright;
      },
      { png: png.toString("base64"), state },
    );
    expect(ink).toBeGreaterThan(0);
    const after = await grid.evaluate((element) => {
      const glyph = Array.from(
        element.querySelectorAll<HTMLElement>("span"),
      ).find((span) => span.textContent === "W")!;
      const r = glyph.getBoundingClientRect();
      return {
        width: r.width,
        next: glyph.nextElementSibling!.getBoundingClientRect().x,
        right: r.right,
      };
    });
    expect(after.width).toBe(state.width);
    expect(after.next).toBe(state.next);
    expect(after.next).toBe(after.right);
  });

  test(`${core} updates text nodes without changing cell geometry or surviving selections`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(30, 4));
    const accent = core === "ghostty" ? "e\u0301" : "λ";
    await write(page, "\x1b[?25l0000 keep 界" + accent + " end");
    const row = page.locator(".term-row").first();
    const retained = await row.evaluateHandle((element, core) => {
      const cells = Array.from(element.children);
      const range = document.createRange();
      if (core === "ghostty") {
        // Tracked selections survive a change elsewhere in the same node.
        range.setStart(cells[0].firstChild!, 5);
        range.setEnd(cells[0].firstChild!, 9);
      } else {
        // Untracked selections remain on an unchanged middle text node.
        range.selectNodeContents(cells[2]);
      }
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return cells.map((cell) => ({
        cell,
        text: cell.firstChild,
        x: cell.getBoundingClientRect().x,
        width: cell.getBoundingClientRect().width,
      }));
    }, core);
    for (const prefix of ["1234", '<&>"']) {
      const replacement = core === "ghostty" ? "a\u0300" : "λ";
      await write(
        page,
        "\x1b[1;1H" + prefix + " keep 語" + replacement + " fin",
      );
      await expect(row).toHaveText(
        new RegExp("keep 語" + replacement + " fin"),
      );
      const state = await page.evaluate(
        (cells) => ({
          cells: cells.map(({ cell, text, x, width }) => ({
            connected: cell.isConnected,
            sameTextNode: cell.firstChild === text,
            dx: cell.getBoundingClientRect().x - x,
            dw: cell.getBoundingClientRect().width - width,
          })),
          selection: window.getSelection()!.toString(),
          copied: window.ptyHarness.selectionText(),
        }),
        retained,
      );
      expect(state.selection).toBe(core === "ghostty" ? "keep" : "λ");
      expect(state.copied).toBe(core === "ghostty" ? "keep" : "λ");
      for (const cell of state.cells) {
        expect(cell.connected).toBe(true);
        expect(cell.sameTextNode).toBe(true);
        expect(Math.abs(cell.dx)).toBeLessThan(0.1);
        expect(Math.abs(cell.dw)).toBeLessThan(0.1);
      }
    }
    await expect(row).toContainText('<&>" keep');
    await retained.dispose();
  });

  test(`${core} preserves Unicode nodes, geometry, and selection during partial redraws`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(30, 4));
    const text = core === "ghostty" ? "界😀e\u0301│█" : "界😀│█";
    await write(page, "\x1b[?25l0000 " + text);
    const row = page.locator(".term-row").first();
    const retained = await row.evaluateHandle((element) => {
      const cells = Array.from(element.children).slice(1);
      const range = document.createRange();
      range.setStart(cells[0].firstChild!, 0);
      const end = cells[cells.length - 2].firstChild!;
      range.setEnd(end, end.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return cells.map((cell) => ({
        cell,
        text: cell.firstChild,
        x: cell.getBoundingClientRect().x,
        width: cell.getBoundingClientRect().width,
      }));
    });

    // Split the leading ASCII run, then merge it again. The suffix includes
    // wide glyphs, box/block drawing, and (with Ghostty) a full grapheme.
    for (const prefix of ["\x1b[31m12\x1b[32m34\x1b[0m ", "abcd "]) {
      await write(page, "\x1b[1;1H" + prefix);
      const state = await page.evaluate(
        (cells) => ({
          cells: cells.map(({ cell, text, x, width }) => ({
            connected: cell.isConnected,
            sameTextNode: cell.firstChild === text,
            dx: cell.getBoundingClientRect().x - x,
            dw: cell.getBoundingClientRect().width - width,
          })),
          selection: window.getSelection()!.toString(),
          copied: window.ptyHarness.selectionText(),
        }),
        retained,
      );
      expect(state.selection).toBe(text);
      expect(state.copied).toBe(text);
      for (const cell of state.cells) {
        expect(cell.connected).toBe(true);
        expect(cell.sameTextNode).toBe(true);
        expect(Math.abs(cell.dx)).toBeLessThan(0.1);
        expect(Math.abs(cell.dw)).toBeLessThan(0.1);
      }
    }
    await retained.dispose();
  });

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
