import { expect, test } from "@playwright/test";

for (const core of ["builtin", "ghostty"]) {
  test(`${core} delivers BEL events without treating OSC terminators as bells`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");

    const write = async (value: string, chunkBytes = 1024) => {
      await page.evaluate(
        ({ data, chunkBytes }) =>
          window.ptyHarness.replayWrite(data, chunkBytes),
        { data: Buffer.from(value).toString("base64"), chunkBytes },
      );
    };
    const bellCounts = () =>
      page.evaluate(() => window.ptyHarness.snapshot().bells);

    await write("\x07\x07");
    expect(await bellCounts()).toEqual([2]);

    await write("\x1b]2;window title\x07", 1);
    expect(await bellCounts()).toEqual([2]);

    await write("\x1b[?2026h\x07");
    expect(await bellCounts()).toEqual([2, 1]);
    await write("\x1b[?2026l");
  });
}
