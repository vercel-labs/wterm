import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, value: string) {
  await page.evaluate((data) => {
    window.ptyHarness.replayWrite(data, 1);
  }, Buffer.from(value).toString("base64"));
  await page.evaluate(() => window.ptyHarness.frame());
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core} keeps the cursor active during a native selection gesture`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay&cursorBlink=false`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    const root = page.locator(".wterm");
    const cursor = root.locator(".term-cursor");
    await write(page, "selectable text\r\n\x1b[2 q");
    const row = root.locator(".term-row").first();
    const points = await row.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const width = parseFloat(
        getComputedStyle(element).getPropertyValue("--term-cell-width"),
      );
      return {
        x: rect.x + width * 0.1,
        y: rect.y + rect.height / 2,
        end: rect.x + width * 10,
      };
    });
    await root.locator("textarea").focus();
    await page.mouse.move(points.x, points.y);
    await page.mouse.down();
    await expect(cursor).toHaveCSS("outline-style", "none");
    await expect(cursor).toHaveCSS("background-color", "rgb(174, 175, 173)");
    await page.mouse.up();
    await expect(root.locator("textarea")).toBeFocused();

    // A real drag must still use the browser's native selection and copy text.
    await page.mouse.move(points.x, points.y);
    await page.mouse.down();
    await page.mouse.move(points.end, points.y, { steps: 10 });
    await expect(cursor).toHaveCSS("outline-style", "none");
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe("selectable");
    await expect
      .poll(() => page.evaluate(() => window.ptyHarness.selectionText()))
      .toBe("selectable");
    await page.locator("#core").focus();
    await expect(cursor).toHaveCSS("outline-style", "solid");

    for (const shape of [4, 6]) {
      await write(page, `\x1b[${shape} q`);
      await root.locator("textarea").focus();
      const shadow = await cursor.evaluate(
        (element) => getComputedStyle(element).boxShadow,
      );
      await page.mouse.move(points.x, points.y);
      await page.mouse.down();
      await expect(cursor).toHaveCSS("outline-style", "none");
      await expect(cursor).toHaveCSS("box-shadow", shadow);
      await page.mouse.up();
    }
  });

  test(`${core} renders application cursor shapes and preserves cell colors while blinking`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    const root = page.locator(".wterm");
    const grid = root.locator(".term-grid");
    const cursor = root.locator(".term-cursor");
    await root.locator("textarea").focus();
    await write(page, "\x1b[31;44m界X\r\x1b[?25l");
    const colors = await root
      .locator(".term-wide")
      .first()
      .evaluate((el) => ({
        fg: getComputedStyle(el).color,
        bg: getComputedStyle(el).backgroundColor,
      }));
    await write(page, "\x1b[?25h\x1b[2 q");
    await expect(cursor).toHaveCount(1);
    await expect(cursor).toHaveText("界");
    await expect(cursor).toHaveCSS("background-color", "rgb(174, 175, 173)");
    await expect(cursor).toHaveCSS("animation-name", "none");
    for (const [style, shape, shadow] of [
      [6, "bar", "2px 0px"],
      [4, "underline", "0px -2px"],
    ] as const) {
      await write(page, `\x1b[${style} q`);
      await expect(grid).toHaveAttribute("data-cursor-shape", shape);
      await expect(cursor).toHaveCSS("color", colors.fg);
      await expect(cursor).toHaveCSS("background-color", colors.bg);
      expect(
        await cursor.evaluate((el) => getComputedStyle(el).boxShadow),
      ).toContain(shadow);
    }
    await write(page, "\x1b[5 q");
    await expect(cursor).toHaveCSS("animation-name", "cursor-line-blink");
    await cursor.evaluate((el) => {
      for (const animation of el.getAnimations()) {
        animation.pause();
        animation.currentTime = 750;
      }
    });
    // Browsers can serialize an animated `none` as a transparent zero shadow.
    await expect(cursor).toHaveCSS(
      "box-shadow",
      /^(none|rgba\(0, 0, 0, 0\) 0px 0px 0px 0px inset)$/,
    );
    await expect(cursor).toHaveCSS("color", colors.fg);
    await expect(cursor).toHaveCSS("background-color", colors.bg);
    await write(page, "\x1b[1 q");
    await expect(cursor).toHaveCSS("animation-name", "cursor-blink");
    await cursor.evaluate((el) => {
      for (const animation of el.getAnimations()) {
        animation.pause();
        animation.currentTime = 750;
      }
    });
    await expect(cursor).toHaveCSS("color", colors.fg);
    await expect(cursor).toHaveCSS("background-color", colors.bg);
    await write(page, "\x1b[?12l");
    await expect(cursor).toHaveCSS("animation-name", "none");
    await write(page, "\x1b[?25l");
    await expect(cursor).toHaveCount(0);
    await write(page, "\x1b[?25h\x1b[6 q");
    await expect(cursor).toHaveCount(1);
    await page.locator("#core").focus();
    await expect(root).not.toHaveClass(/focused/);
    await expect(cursor).toHaveCSS("outline-style", "solid");
    await expect(cursor).toHaveCSS("animation-name", "none");
  });

  for (const forceBlink of [false, true]) {
    test(`${core} respects cursorBlink=${forceBlink} over application requests`, async ({
      page,
    }) => {
      await page.goto(`/?core=${core}&mode=replay&cursorBlink=${forceBlink}`);
      await expect(page.locator("#status")).toHaveText("Replay ready");
      await page.locator(".wterm textarea").focus();
      await write(page, forceBlink ? "\x1b[4 q" : "\x1b[3 q");
      await expect(page.locator(".term-cursor")).toHaveCSS(
        "animation-name",
        forceBlink ? "cursor-line-blink" : "none",
      );
    });
  }
}
