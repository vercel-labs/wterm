import { expect, test } from "@playwright/test";

for (const core of ["builtin", "ghostty"]) {
  test(`${core} reports SGR any-motion once per terminal cell`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(
      (data) => window.ptyHarness.replayWrite(data, 1),
      Buffer.from("\x1b[?1003h\x1b[?1006h").toString("base64"),
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
    await page.mouse.move(cell.x + cell.width * 0.25, cell.y);
    await page.mouse.move(cell.x + cell.width, cell.y);
    const responses = await page.evaluate(
      () => window.ptyHarness.snapshot().responses,
    );
    expect(responses).toHaveLength(2);
    expect(responses).toEqual([
      expect.stringMatching(/^\x1b\[<35;3;1M$/),
      expect.stringMatching(/^\x1b\[<35;4;1M$/),
    ]);
  });
}
