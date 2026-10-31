import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.evaluate(
    (data) => window.ptyHarness.replayWrite(data, 4096),
    Buffer.from(text).toString("base64"),
  );
  await page.evaluate(() => window.ptyHarness.frame());
}
async function clickCell(
  page: Page,
  row: number,
  col: number,
  count: number,
  shift = false,
) {
  const point = await page
    .locator(".term-row")
    .nth(row)
    .evaluate((element, col) => {
      const rect = element.getBoundingClientRect();
      const width = parseFloat(
        getComputedStyle(element.closest(".wterm")!).getPropertyValue(
          "--term-cell-width",
        ),
      );
      return {
        x: rect.left + (col + 0.5) * width,
        y: rect.top + rect.height / 2,
      };
    }, col);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y, { clickCount: count });
  if (shift) await page.keyboard.up("Shift");
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: double-click selects paths and triple-click selects logical lines`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(12, 5));
    await write(page, "run ./src/long-file.ts done\r\nnext");
    await clickCell(page, 1, 2, 2);
    await expect
      .poll(() => page.evaluate(() => window.ptyHarness.selectionText()))
      .toBe(core === "ghostty" ? "./src/long-file.ts" : "ng-file.ts");
    await clickCell(page, 1, 2, 3);
    await expect
      .poll(() => page.evaluate(() => window.ptyHarness.selectionText()))
      .toBe(
        core === "ghostty" ? "run ./src/long-file.ts done" : "ng-file.ts d",
      );
    expect(
      await page.evaluate(() => window.ptyHarness.snapshot().responses),
    ).toEqual([]);
  });
}

test("Ghostty: either half of Unicode cells selects the complete wrapped word and copies it", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(6, 4));
  await write(page, "abcde界e\u0301😀xyz");
  for (const col of [0, 1, 2, 3, 4]) {
    await clickCell(page, 1, col, 2);
    await expect
      .poll(() => page.evaluate(() => window.ptyHarness.selectionText()))
      .toBe("abcde界e\u0301😀xyz");
  }
  await page.evaluate(() => {
    document.addEventListener("copy", (event) => {
      document.body.dataset.copiedText =
        event.clipboardData?.getData("text/plain");
    });
  });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+c" : "Control+c",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-copied-text",
    "abcde界e\u0301😀xyz",
  );
  await page.evaluate(() => {
    const input = document.createElement("textarea");
    input.id = "copy-target";
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+v" : "Control+v",
  );
  // WebKit's system clipboard can normalize combining sequences to NFC.
  // The copy event above checks the exact bytes supplied by WTerm.
  await expect
    .poll(async () =>
      (await page.locator("#copy-target").inputValue()).normalize(),
    )
    .toBe("abcde界e\u0301😀xyz".normalize());
});

test("link text supports word selection while modified clicks retain activation", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(
    page,
    "\x1b]8;;https://example.com\x1b\\./src/long-file.ts\x1b]8;;\x1b\\",
  );
  await page.evaluate(() => {
    document.addEventListener("click", (event) => {
      if (!(event.target as Element).closest("a")) return;
      document.body.dataset.linkPrevented = String(event.defaultPrevented);
      // Inspect link ownership without opening an external page.
      event.preventDefault();
    });
  });
  await clickCell(page, 0, 6, 2);
  await expect
    .poll(() => page.evaluate(() => window.ptyHarness.selectionText()))
    .toBe("./src/long-file.ts");
  await expect(page.locator("body")).toHaveAttribute(
    "data-link-prevented",
    "true",
  );
  await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
  await clickCell(page, 0, 6, 1);
  await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
  await expect(page.locator("body")).toHaveAttribute(
    "data-link-prevented",
    "false",
  );
  await clickCell(page, 2, 2, 1);
  await expect(page.locator("#terminal textarea")).toBeFocused();
  await page.keyboard.type("x");
  expect(
    await page.evaluate(() => window.ptyHarness.snapshot().responses),
  ).toEqual(["x"]);
});

test("logical lines include unmounted wraps and survive reflow and distant output", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(12, 4));
  const line = "path/long-name".repeat(40);
  await write(page, line + "\r\n" + "other\r\n".repeat(100));
  expect(await page.locator(".term-row").count()).toBeLessThan(50);
  expect(await page.evaluate(() => window.ptyHarness.selectLine(0))).toBe(true);
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    line,
  );
  await page.evaluate(() => window.ptyHarness.resize(8, 4));
  await page.evaluate(() => window.ptyHarness.frame());
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    line,
  );
  await write(page, "other\r\n".repeat(100));
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    line,
  );
  expect(await page.locator(".term-row").count()).toBeLessThan(130);
});

test("mouse-reporting apps own live clicks; Shift and history remain selectable", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(20, 4));
  await write(
    page,
    "history-file\r\n" +
      "line\r\n".repeat(30) +
      "live-file\x1b[?1000h\x1b[?1006h",
  );
  const live = (await page.locator(".term-row").count()) - 1;
  await clickCell(page, live, 2, 2);
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).toBeNull();
  expect(
    (await page.evaluate(() => window.ptyHarness.snapshot().responses)).length,
  ).toBeGreaterThan(0);
  await clickCell(page, live, 2, 2, true);
  await expect
    .poll(() => page.evaluate(() => window.ptyHarness.selectionText()))
    .toBe("live-file");
  const before = await page.evaluate(
    () => window.ptyHarness.snapshot().responses.length,
  );
  await page.locator("#terminal").evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.evaluate(() => window.ptyHarness.frame());
  await clickCell(page, 0, 2, 2);
  await expect
    .poll(() => page.evaluate(() => window.ptyHarness.selectionText()))
    .toBe("history-file");
  expect(
    await page.evaluate(() => window.ptyHarness.snapshot().responses.length),
  ).toBe(before);
});

test("pending or synchronized output cannot select unseen text", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(page, "visible");
  expect(
    await page.evaluate(() => {
      window.ptyHarness.replayWrite(btoa("\x1b[?2026h\x1b[Hhidden"), 4096);
      return window.ptyHarness.selectWord({ row: 0, col: 1 });
    }),
  ).toBe(false);
  await clickCell(page, 0, 2, 2);
  expect(
    await page.evaluate(() => window.getSelection()?.toString()),
  ).toContain("visible");
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).not.toContain("hidden");
});
