import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 2 });

for (const core of ["builtin", "ghostty"]) {
  test(`${core} reports SGR pixel press, drag, release, and wheel`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay&binary=true`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(
      (data) => window.ptyHarness.replayWrite(data, 1),
      Buffer.from("\x1b[?1002h\x1b[?1016h").toString("base64"),
    );
    await page.evaluate(() => window.ptyHarness.frame());

    const point = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(
        "#terminal .term-row:not(.term-scrollback-row)",
      )!;
      const rect = row.getBoundingClientRect();
      return { x: Math.ceil(rect.left) + 25, y: Math.ceil(rect.top) + 5 };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 3, point.y + 2);
    await page.mouse.up();
    await page.mouse.wheel(0, 100);

    const snapshot = await page.evaluate(() => window.ptyHarness.snapshot());
    expect(snapshot.responses).toEqual([
      "\x1b[<0;26;6M",
      "\x1b[<32;29;8M",
      "\x1b[<0;29;8m",
      "\x1b[<65;29;8M",
    ]);
    expect(snapshot.binaryResponses).toEqual([]);
  });

  test(`${core} reports unpressed motion once per CSS pixel`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(
      (data) => window.ptyHarness.replayWrite(data, 1),
      Buffer.from("\x1b[?1003h\x1b[?1016h").toString("base64"),
    );
    await page.evaluate(() => window.ptyHarness.frame());

    const point = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(
        "#terminal .term-row:not(.term-scrollback-row)",
      )!;
      const rect = row.getBoundingClientRect();
      return { x: Math.ceil(rect.left) + 25, y: Math.ceil(rect.top) + 5 };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.move(point.x, point.y);
    await page.mouse.move(point.x + 1, point.y);

    const responses = await page.evaluate(
      () => window.ptyHarness.snapshot().responses,
    );
    expect(responses).toEqual(["\x1b[<35;26;6M", "\x1b[<35;27;6M"]);
  });
}
