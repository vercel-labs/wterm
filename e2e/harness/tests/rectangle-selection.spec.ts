import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.evaluate(
    (data) => window.ptyHarness.replayWrite(data, 4096),
    Buffer.from(text).toString("base64"),
  );
  await page.evaluate(() => window.ptyHarness.frame());
}
async function cell(page: Page, row: number, col: number) {
  return page
    .locator(".term-row")
    .nth(row)
    .evaluate((el, col) => {
      const rect = el.getBoundingClientRect();
      const width = parseFloat(
        getComputedStyle(el.closest(".wterm")!).getPropertyValue(
          "--term-cell-width",
        ),
      );
      return {
        x: rect.left + (col + 0.5) * width,
        y: rect.top + rect.height / 2,
      };
    }, col);
}
async function drag(
  page: Page,
  a: [number, number],
  b: [number, number],
  shift = false,
) {
  const start = await cell(page, ...a),
    end = await cell(page, ...b);
  await page.keyboard.down("Alt");
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: Alt-drag copies rectangular columns and leaves typing usable`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(12, 5));
    await write(page, "aa 123 bb\r\ncc 456 dd\r\nee 789 ff");
    await drag(page, [2, 5], [0, 3]);
    await expect
      .poll(() => page.evaluate(() => window.ptyHarness.selectionText()))
      .toBe("123\n456\n789");
    await expect(page.locator(".term-rectangle-row")).toHaveCount(3);
    await page.evaluate(() =>
      document.addEventListener("copy", (event) => {
        document.body.dataset.copied =
          event.clipboardData?.getData("text/plain");
      }),
    );
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+c" : "Control+Shift+c",
    );
    await expect(page.locator("body")).toHaveAttribute(
      "data-copied",
      "123\n456\n789",
    );
    expect(
      await page.evaluate(() => window.ptyHarness.snapshot().responses),
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator(".term-rectangle-row")).toHaveCount(0);
    await page.keyboard.type("x");
    expect(
      await page.evaluate(() => window.ptyHarness.snapshot().responses),
    ).toEqual(["x"]);
  });
}

test("Ghostty rectangle copies complete Unicode cells with matching highlights", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(page, "a界e\u0301😀z\r\n01234567");
  await drag(page, [0, 2], [1, 4]);
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    "界e\u0301😀\n234",
  );
  const ranges = await page.locator(".term-rectangle-row").evaluateAll((rows) =>
    rows.map((el) => {
      const width = parseFloat(
        getComputedStyle(el.closest(".wterm")!).getPropertyValue(
          "--term-cell-width",
        ),
      );
      const style = (el as HTMLElement).style;
      return [
        parseFloat(style.getPropertyValue("--term-selection-left")) / width,
        parseFloat(style.getPropertyValue("--term-selection-width")) / width,
      ];
    }),
  );
  expect(ranges).toEqual([
    [1, 5],
    [2, 3],
  ]);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+c" : "Control+Shift+c",
  );
  await page.evaluate(() => {
    const input = document.createElement("textarea");
    input.id = "paste-target";
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+v" : "Control+v",
  );
  await expect
    .poll(async () =>
      (await page.locator("#paste-target").inputValue()).normalize(),
    )
    .toBe("界e\u0301😀\n234".normalize());
  await expect(page.locator(".term-rectangle-row")).toHaveCount(0);
});

test("rectangle selection reads unmounted history and clears on output and resize", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(page, "first\r\nsecond\r\n" + "other\r\n".repeat(300));
  const mounted = await page.locator(".term-row").count();
  expect(
    await page.evaluate(() =>
      window.ptyHarness.selectRectangle({ row: 0, col: 0 }, { row: 1, col: 2 }),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    "fir\nsec",
  );
  expect(await page.locator(".term-row").count()).toBe(mounted);
  await page.locator("#terminal").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.evaluate(() => window.ptyHarness.frame());
  await expect(page.locator(".term-rectangle-row")).toHaveCount(2);
  await write(page, "more");
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).toBeNull();
  await expect(page.locator(".term-rectangle-row")).toHaveCount(0);
  await page.evaluate(() =>
    window.ptyHarness.selectRectangle({ row: 0, col: 0 }, { row: 1, col: 2 }),
  );
  await page.evaluate(() => window.ptyHarness.resize(60, 24));
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).toBeNull();
});

test("mouse-reporting apps retain Alt-drag; Shift+Alt selects without mouse reports", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(page, "abcde\r\nABCDE\x1b[?1003h\x1b[?1006h");
  await drag(page, [0, 1], [1, 3]);
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).toBeNull();
  const before = await page.evaluate(
    () => window.ptyHarness.snapshot().responses.length,
  );
  expect(before).toBeGreaterThan(0);
  // Move before recording the baseline: all-motion mode reports hover too.
  const start = await cell(page, 0, 1);
  await page.mouse.move(start.x, start.y);
  const hover = await page.evaluate(
    () => window.ptyHarness.snapshot().responses.length,
  );
  await drag(page, [0, 1], [1, 3], true);
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    "bcd\nBCD",
  );
  expect(
    await page.evaluate(() => window.ptyHarness.snapshot().responses.length),
  ).toBe(hover);
});

test("output during a drag cancels the rectangle without selecting replacement text", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(page, "original\r\noriginal");
  const a = await cell(page, 0, 1),
    b = await cell(page, 1, 3);
  await page.keyboard.down("Alt");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await write(page, "\x1b[Hchanged\x1b[?1003h\x1b[?1006h");
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect(
    await page.evaluate(() => window.ptyHarness.selectionText()),
  ).toBeNull();
  await expect(page.locator(".term-rectangle-row")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.ptyHarness.snapshot().responses),
  ).toEqual([]);
});

test("dragging beyond the viewport scrolls history without mounting the rectangle", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(20, 6));
  await write(
    page,
    Array.from(
      { length: 150 },
      (_, i) => `row ${String(i).padStart(3, "0")}\r\n`,
    ).join(""),
  );
  await page.locator("#terminal").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.evaluate(() => window.ptyHarness.frame());
  const start = await cell(page, 0, 4);
  const end = await cell(page, 0, 6);
  const bounds = await page.locator("#terminal").boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, bounds!.y + bounds!.height + 30);
  await expect
    .poll(() => page.locator("#terminal").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(80);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const selected = await page.evaluate(() => window.ptyHarness.selectionText());
  expect(selected?.split("\n")[0]).toBe("000");
  expect(selected!.split("\n").length).toBeGreaterThan(6);
  expect(await page.locator(".term-row").count()).toBeLessThan(80);
  const stopped = await page.locator("#terminal").evaluate(async (el) => {
    const top = el.scrollTop;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { top, after: el.scrollTop };
  });
  expect(stopped.after).toBe(stopped.top);
});

for (const reason of ["Escape", "external focus"]) {
  test(`${reason} ends a drag and stops edge scrolling`, async ({ page }) => {
    await page.goto("/?core=ghostty&mode=replay");
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await write(page, "text to select\r\n".repeat(200));
    await page.locator("#terminal").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.evaluate(() => window.ptyHarness.frame());
    const start = await cell(page, 0, 1);
    const bounds = await page.locator("#terminal").boundingBox();
    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, bounds!.y + bounds!.height + 30);
    await expect
      .poll(() => page.locator("#terminal").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(40);
    if (reason === "Escape") await page.keyboard.press("Escape");
    else
      await page.evaluate(() => {
        const input = document.createElement("input");
        document.body.prepend(input);
        input.focus({ preventScroll: true });
      });
    await expect(page.locator(".term-rectangle-row")).toHaveCount(0);
    const top = await page.locator("#terminal").evaluate((el) => el.scrollTop);
    await page.mouse.move(start.x + 1, bounds!.y + bounds!.height + 30);
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );
    expect(await page.locator("#terminal").evaluate((el) => el.scrollTop)).toBe(
      top,
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");
    expect(
      await page.evaluate(() => window.ptyHarness.selectionText()),
    ).toBeNull();
  });
}
