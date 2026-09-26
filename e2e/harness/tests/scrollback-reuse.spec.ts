import { expect, test } from "@playwright/test";

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: scrolling and incoming output reuse unchanged history DOM`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    const lines = Array.from(
      { length: 200 },
      (_, i) =>
        `\x1b[44mrow ${i} 界😀 \x1b]8;;https://example.com/${i}\x1b\\link\x1b]8;;\x1b\\\x1b[K\x1b[0m\r\n`,
    ).join("");
    await page.evaluate((data) => {
      window.ptyHarness.resize(40, 8);
      window.ptyHarness.replayWrite(data, 4096);
    }, Buffer.from(lines).toString("base64"));
    await page.evaluate(() => window.ptyHarness.frame());

    const result = await page.evaluate(async () => {
      const api = window.ptyHarness;
      const terminal = document.querySelector<HTMLElement>("#terminal")!;
      const height = terminal
        .querySelector(".term-row")!
        .getBoundingClientRect().height;
      const scroll = async (row: number) => {
        terminal.scrollTop = height * row;
        terminal.dispatchEvent(new Event("scroll"));
        await api.frame();
      };
      await scroll(100);
      const rows = () =>
        Array.from(
          terminal.querySelectorAll<HTMLElement>(".term-scrollback-row"),
        );
      const selected = rows().find((row) =>
        row.textContent!.startsWith("row 110 "),
      )!;
      const originalLink = selected.querySelector("a")!;
      const background = getComputedStyle(selected).backgroundColor;
      (document.activeElement as HTMLElement)?.blur();
      const range = document.createRange();
      range.selectNodeContents(selected);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const selectedText = api.selectionText();
      const originalRows = new Set(rows());
      const descriptor = Object.getOwnPropertyDescriptor(
        Element.prototype,
        "innerHTML",
      )!;
      const assignments: Element[] = [];
      Object.defineProperty(Element.prototype, "innerHTML", {
        ...descriptor,
        set(value: string) {
          if (this.classList.contains("term-scrollback-row"))
            assignments.push(this);
          descriptor.set!.call(this, value);
        },
      });
      try {
        // Most of the history window overlaps; only entering rows need DOM.
        await scroll(101);
        const entering = rows().filter((row) => !originalRows.has(row));
        const scrollingAssignments = assignments.length;
        const onlyEntering = assignments.every((row) =>
          entering.includes(row as HTMLElement),
        );
        assignments.length = 0;
        // Output changes history offsets, but the user's visible text is intact.
        api.replayWrite(btoa("new output\r\n".repeat(20)), 4096);
        await api.frame();
        const clipboard = new Map<string, string>();
        const copy = new Event("copy", { bubbles: true, cancelable: true });
        Object.defineProperty(copy, "clipboardData", {
          value: {
            setData: (type: string, value: string) =>
              clipboard.set(type, value),
          },
        });
        document.dispatchEvent(copy);
        return {
          entering: entering.length,
          scrollingAssignments,
          onlyEntering,
          outputAssignments: assignments.length,
          retained:
            selected.isConnected &&
            selected.querySelector("a") === originalLink,
          href: originalLink.href,
          background,
          sameBackground:
            getComputedStyle(selected).backgroundColor === background,
          selectedText,
          copied: clipboard.get("text/plain"),
          nativeText: selection.toString(),
          mounted: rows().length,
        };
      } finally {
        Object.defineProperty(Element.prototype, "innerHTML", descriptor);
      }
    });
    expect(result.entering).toBe(1);
    expect(result.scrollingAssignments).toBe(1);
    expect(result.onlyEntering).toBe(true);
    expect(result.outputAssignments).toBe(0);
    expect(result.retained).toBe(true);
    expect(result.href).toBe("https://example.com/110");
    expect(result.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(result.sameBackground).toBe(true);
    expect(result.selectedText).toBe("row 110 界😀 link");
    expect(result.copied).toBe(result.selectedText);
    expect(result.nativeText.trimEnd()).toBe(result.selectedText);
    expect(result.mounted).toBeLessThan(50);
  });
}
