import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.evaluate(
    (data) => window.ptyHarness.replayWrite(data, 4096),
    Buffer.from(text).toString("base64"),
  );
  await page.evaluate(() => window.ptyHarness.frame());
}
async function select(
  page: Page,
  startRow: number,
  start: number,
  endRow: number,
  end: number,
  backward = false,
) {
  await page.evaluate(
    ({ startRow, start, endRow, end, backward }) => {
      const rows = document.querySelectorAll(".term-row");
      const point = (row: number, offset: number): [Node, number] => {
        const walker = document.createTreeWalker(
          rows[row],
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (offset <= node.textContent!.length) return [node, offset];
          offset -= node.textContent!.length;
        }
        throw new Error(`Invalid row offset ${row}:${offset}`);
      };
      const anchor = point(startRow, start),
        focus = point(endRow, end);
      window
        .getSelection()!
        .setBaseAndExtent(
          ...(backward ? focus : anchor),
          ...(backward ? anchor : focus),
        );
    },
    { startRow, start, endRow, end, backward },
  );
}
async function copy(page: Page) {
  // Dispatch the browser copy event with an isolated data store. This exercises
  // the clipboard handler in all engines without touching the user's clipboard.
  return page.evaluate(() => {
    const clipboard = new Map<string, string>();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (type: string, text: string) => clipboard.set(type, text),
      },
    });
    document.dispatchEvent(event);
    return {
      handled: event.defaultPrevented,
      entries: Array.from(clipboard),
      selection: window.ptyHarness.selectionText(),
    };
  });
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: copies wrapped rows with the core's line semantics`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(6, 5));
    await write(page, "abcdefghij\r\nnext");
    for (const backward of [false, true]) {
      await select(page, 0, 2, 2, 4, backward);
      const expected =
        core === "ghostty" ? "cdefghij\nnext" : "cdef\nghij\nnext";
      expect(await copy(page)).toEqual({
        handled: true,
        entries: [["text/plain", expected]],
        selection: expected,
      });
    }
    await write(page, "\x1bcabcdef\r\nghij");
    await select(page, 0, 0, 1, 4);
    expect((await copy(page)).selection).toBe("abcdef\nghij");
  });

  test(`${core}: copies block glyphs, wide cells and link text without markup`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await write(
      page,
      "\x1b]8;;https://example.com\x1b\\▀▄█│界😀\x1b]8;;\x1b\\",
    );
    await select(page, 0, 0, 0, 7);
    expect((await copy(page)).entries).toEqual([["text/plain", "▀▄█│界😀"]]);
    await expect(page.locator(".term-block").first()).toHaveText("▀");
    await expect(page.locator(".term-block").first()).toHaveCSS(
      "-webkit-text-fill-color",
      "rgba(0, 0, 0, 0)",
    );
    // A copy event must leave the native selection usable for subsequent copies.
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      "▀▄█│界😀",
    );
  });
}

test("Ghostty: joins history to the live screen and expands partial graphemes", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(6, 2));
  await write(page, "abcde界e\u0301😀uvwxyz");
  await page.locator("#terminal").evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.evaluate(() => window.ptyHarness.frame());
  await select(page, 0, 3, 2, 6);
  expect((await copy(page)).selection).toBe("de界e\u0301😀uvwxyz");
  await select(page, 1, 2, 1, 3);
  expect((await copy(page)).selection).toBe("e\u0301");
  await select(page, 1, 4, 1, 5);
  expect((await copy(page)).selection).toBe("😀");
  await page.evaluate(() => window.ptyHarness.resize(20, 4));
  await page.evaluate(() => window.ptyHarness.frame());
  await select(page, 0, 3, 0, 16);
  expect((await copy(page)).selection).toBe("de界e\u0301😀uvwxyz");
});

test("copy uses visible text during synchronized output and defers mixed-page selections", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(6, 4));
  await write(page, "abcdefghij");
  await select(page, 0, 0, 1, 4);
  await write(page, "\x1b[?2026h\x1b[2J\x1b[Hnew");
  expect((await copy(page)).selection).toBe("abcdefghij");
  await page.evaluate(() => {
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    window.getSelection()!.extend(outside.firstChild!, 4);
  });
  expect(await copy(page)).toEqual({
    handled: false,
    entries: [],
    selection: null,
  });
  await write(page, "\x1b[?2026l");
});

test("copy trims hard-line padding while preserving selected spaces and blank lines", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(6, 4));
  await write(page, "a  b\r\n\r\nx");
  await select(page, 0, 0, 2, 1);
  expect((await copy(page)).selection).toBe("a  b\n\nx");
  await select(page, 0, 0, 0, 5);
  expect((await copy(page)).selection).toBe("a  b ");
  await select(page, 0, 0, 1, 0);
  expect((await copy(page)).selection).toBe("a  b\n");
});

test("native Copy shortcut reaches terminal selection handling", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(6, 4));
  await write(page, "abcdefghij");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await select(page, 0, 0, 1, 4);
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    "abcdefghij",
  );
  await page.evaluate(() => {
    document.addEventListener(
      "copy",
      (event) => {
        document.body.dataset.copyTrusted = String(event.isTrusted);
        document.body.dataset.copyHandled = String(event.defaultPrevented);
      },
      { once: true },
    );
  });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+c" : "Control+c",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-copy-handled",
    "true",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-copy-trusted",
    "true",
  );
  // Paste into a separate input to verify the browser's actual clipboard
  // payload through its normal UI path.
  await page.evaluate(() => {
    const input = document.createElement("textarea");
    input.id = "copy-target";
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+v" : "Control+v",
  );
  await expect(page.locator("#copy-target")).toHaveValue("abcdefghij");
});

test("Ghostty: selection follows Unicode through reflow and distant output", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(6, 4));
  await write(page, "abcde界e\u0301😀uvwxyz");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await select(page, 0, 3, 2, 5, true);
  const expected = (await copy(page)).selection;
  expect(expected).toBe("de界e\u0301😀uvwxyz");
  for (const cols of [4, 12, 6]) {
    await page.evaluate((cols) => window.ptyHarness.resize(cols, 4), cols);
    await page.evaluate(() => window.ptyHarness.frame());
    expect((await copy(page)).selection).toBe(expected);
    expect(
      await page.evaluate(() => {
        const selection = window.getSelection()!;
        const range = selection.getRangeAt(0);
        return (
          selection.focusNode === range.startContainer &&
          selection.focusOffset === range.startOffset
        );
      }),
    ).toBe(true);
  }
  await write(page, "\r\nline\r\n" + "line\r\n".repeat(500));
  expect((await copy(page)).selection).toBe(expected);
  expect(await page.locator(".term-row").count()).toBeLessThan(80);
  await page.locator("#terminal").evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.evaluate(() => window.ptyHarness.frame());
  expect((await copy(page)).selection).toBe(expected);
});

test("Ghostty: selection clears on overwrite, reset, and pruning without stealing external selections", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => window.ptyHarness.resize(6, 4));
  await write(page, "abcdef");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await select(page, 0, 0, 0, 3);
  await write(page, "\x1b[Hnew");
  expect((await copy(page)).selection).toBeNull();
  await select(page, 0, 0, 0, 3);
  await write(page, "\x1b[?1049h\x1b[?1049l");
  expect((await copy(page)).selection).toBeNull();
  await select(page, 0, 0, 0, 3);
  await write(page, "\x1bc");
  expect((await copy(page)).selection).toBeNull();
  await write(page, "chosen");
  await select(page, 0, 0, 0, 6);
  await write(page, "\r\nline\r\n" + "line\r\n".repeat(20000));
  expect((await copy(page)).selection).toBeNull();
  await page.evaluate(() => {
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    window
      .getSelection()!
      .setBaseAndExtent(outside.firstChild!, 0, outside.firstChild!, 7);
    window.ptyHarness.resize(12, 4);
  });
  await page.evaluate(() => window.ptyHarness.frame());
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    "outside",
  );
});
