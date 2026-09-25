import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.evaluate((text) => {
    const bytes = new TextEncoder().encode(text);
    window.ptyHarness.replayWrite(btoa(String.fromCharCode(...bytes)), 37);
  }, text);
  await page.evaluate(() => window.ptyHarness.frame());
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: optional announcements use terminal text and stop when focus leaves`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    const input = page.getByRole("textbox", { name: "Terminal", exact: true });
    const log = page.getByRole("log", { name: "Terminal output" });
    await write(page, "existing output\r\n");
    await expect(log).toHaveCount(0);
    await page.evaluate(() => window.ptyHarness.setOutputAnnouncements(true));
    await expect(log).toHaveText("");
    await expect(input).toBeFocused();
    await expect(log).toHaveAttribute("aria-live", "polite");
    await write(page, "\x1b[31mresult 語 e\u0301 😀\x1b[0m\r\n");
    await expect(log).toHaveText("result 語 e\u0301 😀");
    expect(await page.locator("#terminal").ariaSnapshot()).toContain(
      'log "Terminal output"',
    );
    await page.locator("#download").focus();
    await expect(log).toHaveText("");
    await write(page, "background\r\n");
    await input.focus();
    await write(page, "foreground\r\n");
    await expect(log).toHaveText("foreground");
    await page.evaluate(() => window.ptyHarness.setOutputAnnouncements(false));
    await expect(log).toHaveCount(0);
    await expect(input).toBeFocused();
  });

  test(`${core}: announcements include new scrollback, limit floods, and resume after input`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await write(
      page,
      Array.from({ length: 24 }, (_, i) => `old ${i}`).join("\r\n"),
    );
    await page.evaluate(() => window.ptyHarness.setOutputAnnouncements(true));
    const log = page.getByRole("log", { name: "Terminal output" });
    await write(page, "\r\nnew one\r\nnew two\r\nnew three");
    await expect(log).toHaveText("new one\nnew two\nnew three");
    await write(
      page,
      "\r\n" + Array.from({ length: 100 }, (_, i) => `flood ${i}`).join("\r\n"),
    );
    await expect(log).toContainText("Output announcements paused");
    await page.keyboard.press("Enter");
    await write(page, "\r\nnext result");
    await expect(log).toHaveText("next result");
    expect(
      await page.evaluate(() => window.ptyHarness.snapshot().responses),
    ).toEqual(["\r"]);
    await page.evaluate(() => window.ptyHarness.close());
    await expect(log).toHaveCount(0);
  });

  test(`${core}: held frames stay silent and repeated results produce new log entries`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.setOutputAnnouncements(true));
    const log = page.getByRole("log", { name: "Terminal output" });
    await write(page, "\x1b[?2026h\x1b[Hworking");
    await expect(log).toHaveText("");
    await write(page, "\r\x1b[2Kdone\x1b[?2026l");
    await expect(log).toHaveText("done");
    await log.evaluate((el) => {
      (window as any).firstAnnouncement = el.firstChild;
    });
    await page.keyboard.press("Enter");
    await write(page, "\r\ndone");
    await expect
      .poll(() =>
        log.evaluate(
          (el) => el.firstChild !== (window as any).firstAnnouncement,
        ),
      )
      .toBe(true);
    await expect(log).toHaveText("done");
  });
}
