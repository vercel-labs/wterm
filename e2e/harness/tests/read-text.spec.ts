import { expect, test } from "@playwright/test";

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: text captures read unmounted history without changing focus or selection`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    const lines = Array.from(
      { length: 700 },
      (_, i) => `record ${i} 語 e\u0301 😀`,
    );
    await page.evaluate((lines) => {
      const bytes = new TextEncoder().encode(lines.join("\r\n"));
      window.ptyHarness.replayWrite(btoa(String.fromCharCode(...bytes)), 4096);
    }, lines);
    await page.evaluate(() => window.ptyHarness.frame());
    const input = page.getByRole("textbox", { name: "Terminal", exact: true });
    await expect(input).toBeFocused();
    await expect(page.getByText(lines[0], { exact: true })).toHaveCount(0);
    const rows = await page.locator(".term-row").count();
    await page.evaluate(() => window.ptyHarness.selectAll());
    const text = await page.evaluate(() => window.ptyHarness.readText());
    expect(text).toBe(lines.join("\n"));
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
      text,
    );
    expect(await page.locator(".term-row").count()).toBe(rows);
    await page.evaluate(() =>
      window.ptyHarness.replayWrite(btoa("\r\nnew line"), 4096),
    );
    expect(text).toBe(lines.join("\n"));
    expect(await page.evaluate(() => window.ptyHarness.readText())).toBe(
      `${text}\nnew line`,
    );
  });
}

test("pending captures reject on writes and explicit abort, then recover", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  expect(
    await page.evaluate(async () => {
      const changed = window.ptyHarness.readText().catch((error) => error.name);
      window.ptyHarness.replayWrite(btoa("changed"), 4096);
      const controller = new AbortController();
      const cancelled = window.ptyHarness
        .readText({ signal: controller.signal })
        .catch((error) => error.name);
      controller.abort();
      return [await changed, await cancelled];
    }),
  ).toEqual(["AbortError", "AbortError"]);
  expect(await page.evaluate(() => window.ptyHarness.readText())).toMatch(
    /^changed\n/,
  );
});
