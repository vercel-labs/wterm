import { expect, test } from "@playwright/test";

// Vim negotiates modifyOtherKeys level 2 for xterm terminals. Without it,
// Ctrl+Shift+E and Ctrl+E both arrive as 0x05 and cannot be mapped apart.
// (Ctrl+Shift+A is WTerm's own Select All.)
for (const core of ["builtin", "ghostty"]) {
  test(`${core}: Vim tells Ctrl+Shift+E from Ctrl+E through modifyOtherKeys`, async ({
    page,
  }) => {
    test.slow();
    await page.goto(`/?core=${core}`);
    await expect(page.locator("#status")).toHaveText("Connected · /bin/sh");
    const rows = () => page.evaluate(() => window.ptyHarness.snapshot().rows);
    const mode = () =>
      page.evaluate(() => window.ptyHarness.snapshot().modes.modifyOtherKeys);
    await expect
      .poll(async () => (await rows()).join("\n"))
      .toContain("wterm$");

    await page.keyboard.type(
      `vim -u NONE -N -i NONE -c 'nnoremap <C-S-e> :echo "mok:shifted"<CR>' -c 'nnoremap <C-e> :echo "mok:plain"<CR>'`,
    );
    await page.keyboard.press("Enter");
    await expect.poll(mode, { timeout: 15_000 }).toBe(2);

    // Vim drops keys while it finishes querying the terminal at startup, and
    // holds a key for 'timeoutlen' before running its mapping, so press until
    // the mapping answers and give each press that long.
    const pressUntil = async (key: string, message: string) =>
      expect(async () => {
        await page.keyboard.press(key);
        await expect
          .poll(async () => (await rows()).join("\n"), { timeout: 3_000 })
          .toContain(message);
      }).toPass({ timeout: 20_000 });
    await pressUntil("Control+Shift+E", "mok:shifted");
    await pressUntil("Control+e", "mok:plain");

    await page.keyboard.type(":q!");
    await page.keyboard.press("Enter");
    await expect.poll(mode).toBe(0);
  });
}
