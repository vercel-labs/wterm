import { expect, test } from "@playwright/test";

const exitHint =
  "Press Escape, then Tab to move focus out of the terminal, or Shift+Tab to move focus backward.";

for (const core of ["builtin", "ghostty"]) {
  test(`${core}: input is one named editable control and output stays readable`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    const input = page.getByRole("textbox", { name: "Terminal", exact: true });
    await expect(input).toHaveCount(1);
    await expect(input).toBeFocused();
    await expect(input).toHaveAccessibleDescription(exitHint);
    expect(await input.evaluate((el) => el.tagName)).toBe("TEXTAREA");
    await page.keyboard.type("echo hello");
    expect(
      (await page.evaluate(() => window.ptyHarness.snapshot().responses)).join(
        "",
      ),
    ).toBe("echo hello");
    await page.evaluate(() =>
      window.ptyHarness.replayWrite(btoa("visible terminal output"), 4096),
    );
    await page.evaluate(() => window.ptyHarness.frame());
    const tree = await page.locator("#terminal").ariaSnapshot();
    expect(tree).toContain('textbox "Terminal"');
    expect(tree).toContain("visible terminal output");
    expect(tree.match(/textbox/g)).toHaveLength(1);
  });
}

test("host labels and descriptions update the actual input without changing focus", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => {
    const heading = document.createElement("h2");
    heading.id = "terminal-heading";
    heading.textContent = "Build shell";
    const help = document.createElement("p");
    help.id = "terminal-help";
    help.textContent = "Commands run in the selected session";
    document.body.append(heading, help);
    const host = document.querySelector("#terminal")!;
    host.setAttribute("aria-label", "Fallback name");
    host.setAttribute("aria-labelledby", heading.id);
    host.setAttribute("aria-describedby", help.id);
  });
  const input = page.locator("#terminal textarea");
  await expect(input).toHaveAccessibleName("Build shell");
  await expect(input).toHaveAccessibleDescription(
    `Commands run in the selected session ${exitHint}`,
  );
  await expect(input).toBeFocused();
  await page.locator("#download").focus();
  await page.evaluate(() => {
    document.querySelector("#terminal-heading")!.textContent = "Test shell";
    document.querySelector("#terminal-help")!.textContent = "Local commands";
  });
  await expect(input).toHaveAccessibleName("Test shell");
  await expect(input).toHaveAccessibleDescription(`Local commands ${exitHint}`);
  await page.evaluate(() => {
    const host = document.querySelector("#terminal")!;
    host.removeAttribute("aria-labelledby");
    host.removeAttribute("aria-describedby");
  });
  await expect(input).toHaveAccessibleName("Fallback name");
  await expect(input).toHaveAccessibleDescription(exitHint);
  await page.evaluate(() =>
    document
      .querySelector("#terminal")!
      .setAttribute("aria-description", "A local shell."),
  );
  await expect(input).toHaveAccessibleDescription(`A local shell. ${exitHint}`);
  await page.evaluate(() =>
    document.querySelector("#terminal")!.removeAttribute("aria-label"),
  );
  await expect(input).toHaveAccessibleName("Terminal");
  await expect(page.locator("#download")).toBeFocused();
});

test("tabIndex controls one input tab stop, including dynamic -1 and removal", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.evaluate(() => {
    const host = document.querySelector("#terminal")!;
    // Text inputs participate in WebKit's default macOS tab navigation even
    // when the system setting to tab through buttons and links is disabled.
    for (const id of ["before-terminal", "after-terminal"]) {
      const control = document.createElement("input");
      control.id = id;
      control.setAttribute("aria-label", id);
      host.insertAdjacentElement(
        id.startsWith("before") ? "beforebegin" : "afterend",
        control,
      );
    }
    host.setAttribute("tabindex", "0");
  });
  const before = page.locator("#before-terminal");
  const after = page.locator("#after-terminal");
  const input = page.getByRole("textbox", { name: "Terminal", exact: true });
  await expect(page.locator("#terminal")).toHaveAttribute("tabindex", "-1");
  await before.focus();
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  // Tab is still terminal input; tabIndex only controls entry from the page.
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => window.ptyHarness.snapshot().responses),
  ).toEqual(["\t"]);
  await after.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(input).toBeFocused();
  await page.evaluate(() =>
    document.querySelector("#terminal")!.setAttribute("tabindex", "-1"),
  );
  await expect(input).toHaveAttribute("tabindex", "-1");
  await before.focus();
  await page.keyboard.press("Tab");
  await expect(after).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(before).toBeFocused();
  await page.evaluate(() =>
    document.querySelector("#terminal")!.removeAttribute("tabindex"),
  );
  await expect(input).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
});

test("host hiding remains authoritative and teardown removes the editable control", async ({
  page,
}) => {
  await page.goto("/?core=ghostty&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  await page.locator("#download").focus();
  await page
    .locator("#terminal")
    .evaluate((el) => el.setAttribute("aria-hidden", "true"));
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page
    .locator("#terminal")
    .evaluate((el) => el.removeAttribute("aria-hidden"));
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await page.evaluate(() => window.ptyHarness.close());
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.locator("#download")).toBeFocused();
});
