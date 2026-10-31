import { expect, test, type Page } from "@playwright/test";

const marker = (value: string) => `\x1b]133;${value}\x07`;
const command = (name: string, lines = 100) =>
  marker("A;redraw=0") +
  name +
  "> " +
  marker("B") +
  "echo output" +
  marker("C") +
  "\r\n" +
  "ordinary output\r\n".repeat(lines) +
  marker("D;0");
async function write(page: Page, text: string) {
  await page.evaluate(
    (data) => window.ptyHarness.replayWrite(data, 4096),
    Buffer.from(text).toString("base64"),
  );
  await page.evaluate(() => window.ptyHarness.frame());
}
async function jump(page: Page, direction: -1 | 1) {
  const moved = await page.evaluate(
    (direction) => window.ptyHarness.scrollToPrompt(direction),
    direction,
  );
  await page.evaluate(() => window.ptyHarness.frame());
  return moved;
}
async function topText(page: Page) {
  return page.locator("#terminal").evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    return Array.from(element.querySelectorAll(".term-row")).find(
      (row) => row.getBoundingClientRect().bottom > top + 2,
    )?.textContent;
  });
}

test("Ghostty navigates unmounted prompts in both directions without moving focus or selection", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(
    page,
    command("first") +
      command("second") +
      command("third") +
      marker("A;redraw=0") +
      "current> " +
      marker("B"),
  );
  await page.locator("#terminal textarea").focus();
  await expect(
    page.locator(".term-row").filter({ hasText: "first>" }),
  ).toHaveCount(0);
  expect(await jump(page, -1)).toBe(true);
  await expect.poll(() => topText(page)).toContain("third>");
  expect(await jump(page, -1)).toBe(true);
  await expect.poll(() => topText(page)).toContain("second>");
  expect(await jump(page, -1)).toBe(true);
  await expect.poll(() => topText(page)).toContain("first>");
  expect(await jump(page, -1)).toBe(false);
  await expect(page.locator("#terminal textarea")).toBeFocused();
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll(".term-row")).find((el) =>
      el.textContent?.includes("first>"),
    )!;
    const range = document.createRange();
    range.selectNodeContents(row);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  const selected = await page.evaluate(() => window.ptyHarness.selectionText());
  expect(await jump(page, 1)).toBe(true);
  await expect.poll(() => topText(page)).toContain("second>");
  expect(await page.evaluate(() => window.ptyHarness.selectionText())).toBe(
    selected,
  );
  await page.evaluate(() => window.ptyHarness.clearSelection());
  expect(await jump(page, 1)).toBe(true);
  await expect.poll(() => topText(page)).toContain("third>");
  expect(await jump(page, 1)).toBe(true);
  expect(await jump(page, 1)).toBe(false);
  expect(await page.locator(".term-row").count()).toBeLessThan(100);
  expect(
    (await page.evaluate(() => window.ptyHarness.snapshot())).responses,
  ).toEqual([]);
});

test("Ghostty navigation follows reflow and waits for synchronized or paused painting", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(
    page,
    command("first-long-prompt") +
      command("second-long-prompt") +
      command("third-long-prompt"),
  );
  await page.evaluate(() => window.ptyHarness.resize(10, 24));
  await page.evaluate(() => window.ptyHarness.frame());
  expect(await jump(page, -1)).toBe(true);
  await expect.poll(() => topText(page)).toContain("third-long");
  expect(await jump(page, -1)).toBe(true);
  await expect.poll(() => topText(page)).toContain("second-lon");
  const before = await page.locator("#terminal").evaluate((el) => el.scrollTop);
  await page.evaluate(() => window.ptyHarness.setRenderingPaused(true));
  expect(await jump(page, -1)).toBe(false);
  await page.evaluate(() => window.ptyHarness.setRenderingPaused(false));
  await write(page, "\x1b[?2026h");
  expect(await jump(page, -1)).toBe(false);
  expect(await page.locator("#terminal").evaluate((el) => el.scrollTop)).toBe(
    before,
  );
  await write(page, "\x1b[?2026l");
  expect(await jump(page, -1)).toBe(true);
  await expect.poll(() => topText(page)).toContain("first-long");
  await write(page, "\x1b[?1049h" + command("alternate", 2));
  expect(await jump(page, -1)).toBe(false);
  await write(page, "\x1b[?1049l\x1bc");
  expect(await jump(page, -1)).toBe(false);
});

test("unsupported cores leave navigation and input unchanged", async ({
  page,
}) => {
  await page.goto("/?core=builtin&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await write(page, command("one") + command("two"));
  const before = await page.locator("#terminal").evaluate((el) => el.scrollTop);
  expect(await jump(page, -1)).toBe(false);
  expect(await jump(page, 1)).toBe(false);
  expect(await page.locator("#terminal").evaluate((el) => el.scrollTop)).toBe(
    before,
  );
});
