import { expect, test } from "@playwright/test";

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: paused output keeps terminal effects and paints the final resized screen`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    const result = await page.evaluate(async () => {
      const api = window.ptyHarness;
      const write = (text: string) => api.replayWrite(btoa(text), 1);
      api.resize(20, 4);
      write("before pause");
      await api.frame();
      const grid = document.querySelector(".term-grid")!;
      const before = grid.innerHTML;
      api.setRenderingPaused(true);
      write(
        "\x1b[?1049h\x1b[Halternate\x1b[?1049l\x1b[Hafter pause\x1b]2;background title\x07\x07\x1b[6n",
      );
      api.resize(30, 6);
      await api.frame();
      const held = grid.innerHTML;
      const effects = api.snapshot();
      api.setRenderingPaused(false);
      await api.frame();
      return {
        before,
        held,
        effects,
        text: grid.textContent,
        rows: grid.querySelectorAll(".term-row").length,
      };
    });
    expect(result.held).toBe(result.before);
    expect(result.effects.titles).toContain("background title");
    expect(result.effects.bells).toEqual([1]);
    expect(result.effects.responses).toContain("\x1b[1;12R");
    expect(result.text).toContain("after pause");
    expect(result.rows).toBe(6);
    expect(result.text).not.toContain("alternate");
  });

  test(`${core}: resumed history stays readable after hidden output and synchronized resize`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => {
      window.ptyHarness.resize(20, 4);
      window.ptyHarness.setRenderingPaused(true);
      window.ptyHarness.replayWrite(
        btoa(
          "\x1b[?2026h" +
            Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join(""),
        ),
        17,
      );
      window.ptyHarness.resize(30, 6);
      window.ptyHarness.setRenderingPaused(false);
    });
    await page.evaluate(() => window.ptyHarness.frame());
    await expect(page.locator(".term-grid")).not.toContainText("line 99");
    await page.evaluate(() =>
      window.ptyHarness.replayWrite(btoa("\x1b[?2026lend"), 1),
    );
    await expect(page.locator(".term-grid")).toContainText("line 99");
    const text = await page.evaluate(() => window.ptyHarness.readText());
    expect(text).toMatch(/^line 0\nline 1\n/);
    expect(text).toMatch(/line 99\nend\n*$/);
  });
}
