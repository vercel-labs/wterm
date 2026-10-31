import { expect, test } from "@playwright/test";

for (const core of ["builtin", "ghostty"]) {
  test(`${core} delivers terminal window titles to WTerm`, async ({ page }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");

    const write = async (value: string) => {
      await page.evaluate(
        (data) => window.ptyHarness.replayWrite(data, 1),
        Buffer.from(value).toString("base64"),
      );
      await page.evaluate(() => window.ptyHarness.frame());
    };

    await write("\x1b]0;café\x07");
    expect(
      (await page.evaluate(() => window.ptyHarness.snapshot())).titles,
    ).toEqual(["café"]);

    await write("\x1b]2;\x1b\\");
    expect(
      (await page.evaluate(() => window.ptyHarness.snapshot())).titles,
    ).toEqual(["café", ""]);
  });
}
