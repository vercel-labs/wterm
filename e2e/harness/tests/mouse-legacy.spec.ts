import { expect, test } from "@playwright/test";

for (const core of ["builtin", "ghostty"]) {
  test(`${core} reports X10 press, drag, release, and wheel`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(
      (data) => window.ptyHarness.replayWrite(data, 1),
      Buffer.from("\x1b[?1002h").toString("base64"),
    );
    await page.evaluate(() => window.ptyHarness.frame());

    const cell = await page.evaluate(() => {
      const terminal = document.querySelector<HTMLElement>("#terminal")!;
      const row = terminal.querySelector<HTMLElement>(
        ".term-row:not(.term-scrollback-row)",
      )!;
      const rect = row.getBoundingClientRect();
      const width = parseFloat(
        getComputedStyle(terminal).getPropertyValue("--term-cell-width"),
      );
      return {
        x: rect.left + width * 2.25,
        y: rect.top + rect.height / 2,
        width,
      };
    });
    expect(cell.width).toBeGreaterThan(0);

    await page.mouse.move(cell.x, cell.y);
    await page.mouse.down();
    await page.mouse.move(cell.x + cell.width, cell.y);
    await page.mouse.up();
    await page.mouse.wheel(0, 100);

    const responses = await page.evaluate(
      () => window.ptyHarness.snapshot().responses,
    );
    expect(responses).toEqual([
      String.fromCharCode(27, 91, 77, 32, 35, 33),
      String.fromCharCode(27, 91, 77, 64, 36, 33),
      String.fromCharCode(27, 91, 77, 35, 36, 33),
      String.fromCharCode(27, 91, 77, 97, 36, 33),
    ]);
  });

  test(`${core} preserves X10 bytes past column 95`, async ({ page }) => {
    await page.goto(`/?core=${core}&mode=replay&binary=true`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(120, 24));
    await page.evaluate(
      (data) => window.ptyHarness.replayWrite(data, 1),
      Buffer.from("\x1b[?1000h").toString("base64"),
    );
    await page.evaluate(() => window.ptyHarness.frame());

    const point = await page.evaluate(() => {
      const terminal = document.querySelector<HTMLElement>("#terminal")!;
      const row = terminal.querySelector<HTMLElement>(
        ".term-row:not(.term-scrollback-row)",
      )!;
      const rect = row.getBoundingClientRect();
      const width = parseFloat(
        getComputedStyle(terminal).getPropertyValue("--term-cell-width"),
      );
      return { x: rect.left + width * 99.25, y: rect.top + rect.height / 2 };
    });

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.up();

    const snapshot = await page.evaluate(() => window.ptyHarness.snapshot());
    expect(snapshot.responses).toEqual([]);
    expect(snapshot.binaryResponses).toEqual([
      [27, 91, 77, 32, 132, 33],
      [27, 91, 77, 35, 132, 33],
    ]);
  });
}
