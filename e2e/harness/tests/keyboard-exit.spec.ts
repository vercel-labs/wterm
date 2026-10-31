import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, core = "ghostty", flags = 0) {
  await page.goto(`/?core=${core}&mode=replay`);
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(async (flags) => {
    const host = document.querySelector("#terminal")!;
    // Text inputs are in the default macOS WebKit tab order, unlike buttons.
    for (const id of ["before-terminal", "after-terminal"]) {
      const input = document.createElement("input");
      input.id = id;
      input.setAttribute("aria-label", id);
      host.insertAdjacentElement(
        id.startsWith("before") ? "beforebegin" : "afterend",
        input,
      );
    }
    if (flags) {
      await window.ptyHarness.replayWrite(btoa(`\x1b[>${flags}u`), 4096);
      await window.ptyHarness.frame();
    }
  }, flags);
}

async function responses(page: Page) {
  return page.evaluate(() => window.ptyHarness.snapshot().responses);
}

for (const [core, flags] of [
  ["builtin", 0],
  ["ghostty", 0],
  ["ghostty", 31],
] as const) {
  test(`${core}, Kitty ${flags}: native forward/backward exit and reentry preserve application Tab`, async ({
    page,
  }) => {
    await setup(page, core, flags);
    const input = page.getByRole("textbox", { name: "Terminal", exact: true });
    const before = page.locator("#before-terminal");
    const after = page.locator("#after-terminal");
    await before.focus();
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    // The release of the Tab used to enter is not terminal input.
    expect(await responses(page)).toEqual([]);
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    expect(await responses(page)).toEqual(
      flags ? ["\x1b[9u", "\x1b[9;1:3u"] : ["\t"],
    );
    await page.keyboard.press("Escape");
    const beforeExit = await responses(page);
    expect(beforeExit.slice(flags ? -2 : -1)).toEqual(
      flags ? ["\x1b[27u", "\x1b[27;1:3u"] : ["\x1b"],
    );
    await page.keyboard.press("Tab");
    await expect(after).toBeFocused();
    expect(await responses(page)).toEqual(beforeExit);
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    expect(await responses(page)).toEqual(beforeExit);
    await page.keyboard.press("Escape");
    await page.keyboard.down("Shift");
    const beforeBack = await responses(page);
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    await expect(before).toBeFocused();
    expect(await responses(page)).toEqual(beforeBack);
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    expect((await responses(page)).slice(flags ? -4 : -1)).toEqual(
      flags
        ? ["\x1b[57441;2u", "\x1b[9;2u", "\x1b[9;2:3u", "\x1b[57441;1:3u"]
        : ["\x1b[Z"],
    );
  });
}

test("typing, clicking, and composition cancel a pending exit", async ({
  page,
}) => {
  await setup(page);
  const input = page.getByRole("textbox", { name: "Terminal", exact: true });
  for (const action of ["typing", "click", "composition"] as const) {
    await page.keyboard.press("Escape");
    if (action === "typing") await page.keyboard.type("x");
    if (action === "click")
      await page.locator("#terminal").click({ position: { x: 5, y: 5 } });
    if (action === "composition")
      await input.evaluate((el) => {
        el.dispatchEvent(new CompositionEvent("compositionstart"));
        el.dispatchEvent(
          new CompositionEvent("compositionend", { data: "語" }),
        );
      });
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    expect((await responses(page)).at(-1)).toBe("\t");
  }
});

test("Escape can clear Select All before leaving, and blur resets the exit sequence", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(async () => {
    await window.ptyHarness.replayWrite(btoa("selected output"), 4096);
    await window.ptyHarness.frame();
  });
  await page.keyboard.press("Control+Shift+A");
  await expect(page.locator("#terminal")).toHaveClass(/term-select-all/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#terminal")).not.toHaveClass(/term-select-all/);
  expect(await responses(page)).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(page.locator("#after-terminal")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const input = page.getByRole("textbox", { name: "Terminal", exact: true });
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await page.locator("#after-terminal").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  expect(await responses(page)).toEqual(["\x1b", "\t"]);
});
