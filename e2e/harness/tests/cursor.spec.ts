import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, value: string) {
  await page.evaluate((data) => {
    window.ptyHarness.replayWrite(data, 1);
  }, Buffer.from(value).toString("base64"));
  await page.evaluate(() => window.ptyHarness.frame());
}

for (const core of ["builtin", "ghostty"]) {
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
