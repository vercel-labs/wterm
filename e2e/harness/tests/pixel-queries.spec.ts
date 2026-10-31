import { expect, test } from "@playwright/test";

for (const core of ["builtin", "ghostty"]) {
  test(`${core} preserves fragmented pixel queries through Unicode and ANSI output`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    const result = await page.evaluate(async () => {
      const api = window.ptyHarness;
      const write = (text: string, chunk: number) => {
        const bytes = new TextEncoder().encode(text);
        api.replayWrite(
          btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")),
          chunk,
        );
      };
      // Ordinary UTF-8 bytes split inside graphemes, then query prefixes split
      // at every byte. A paused pane must still deliver its geometry replies.
      api.setRenderingPaused(true);
      write("\x1b[31m色🙂\x1b[0m\r\n".repeat(128), 31);
      write("\x1b[14t\x1b[16t\x1b[14t", 1);
      api.setRenderingPaused(false);
      await api.frame();
      const element = document.querySelector<HTMLElement>("#terminal")!;
      const style = getComputedStyle(element);
      return {
        responses: api.snapshot().responses,
        width:
          element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        height:
          element.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom),
        cellWidth: Math.round(
          parseFloat(style.getPropertyValue("--term-cell-width")),
        ),
        rowHeight: Math.round(
          parseFloat(style.getPropertyValue("--term-row-height")),
        ),
        text: document.querySelector(".term-grid")!.textContent,
      };
    });
    expect(result.responses).toEqual([
      `\x1b[4;${result.height};${result.width}t`,
      `\x1b[6;${result.rowHeight};${result.cellWidth}t`,
      `\x1b[4;${result.height};${result.width}t`,
    ]);
    expect(result.text).toContain("色🙂");
    expect(result.text).not.toContain("�");
  });
}
