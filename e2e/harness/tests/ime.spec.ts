import { expect, test } from "@playwright/test";

for (const core of ["builtin", "ghostty"]) {
  test(`${core} shows IME preedit at the cursor and sends only committed text`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(40, 5));
    await page.evaluate(() =>
      window.ptyHarness.replayWrite(btoa("\x1b[3;12H"), 1),
    );
    await page.evaluate(() => window.ptyHarness.frame());

    const preedit = await page.evaluate(() => {
      const textarea =
        document.querySelector<HTMLTextAreaElement>("#terminal textarea")!;
      textarea.dispatchEvent(new CompositionEvent("compositionstart"));
      textarea.value = "にほんご";
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.dispatchEvent(
        new InputEvent("input", {
          data: "にほんご",
          inputType: "insertCompositionText",
          bubbles: true,
        }),
      );
      const cursor = document.querySelector<HTMLElement>(
        "#terminal .term-cursor",
      )!;
      const inputRect = textarea.getBoundingClientRect();
      const cursorRect = cursor.getBoundingClientRect();
      return {
        text: textarea.value,
        opacity: getComputedStyle(textarea).opacity,
        width: inputRect.width,
        cellWidth: cursorRect.width,
        left: inputRect.left - cursorRect.left,
        top: inputRect.top - cursorRect.top,
        responses: window.ptyHarness.snapshot().responses,
      };
    });
    expect(preedit.text).toBe("にほんご");
    expect(preedit.opacity).toBe("1");
    expect(preedit.width).toBeLessThan(preedit.cellWidth * 12);
    expect(Math.abs(preedit.left)).toBeLessThan(1);
    expect(Math.abs(preedit.top)).toBeLessThan(1);
    expect(preedit.responses).toEqual([]);

    const committed = await page.evaluate(() => {
      const textarea =
        document.querySelector<HTMLTextAreaElement>("#terminal textarea")!;
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", { data: "日本語" }),
      );
      textarea.value = "日本語";
      textarea.dispatchEvent(
        new InputEvent("input", {
          data: "日本語",
          inputType: "insertText",
          bubbles: true,
        }),
      );
      return {
        value: textarea.value,
        opacity: getComputedStyle(textarea).opacity,
        responses: window.ptyHarness.snapshot().responses,
      };
    });
    expect(committed.value).toBe("");
    expect(committed.opacity).toBe("0");
    expect(committed.responses).toEqual(["日本語"]);
  });

  test(`${core} returns to the live cursor when composition starts in scrollback`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(40, 5));
    await page.evaluate(() =>
      window.ptyHarness.replayWrite(
        btoa(Array.from({ length: 30 }, (_, i) => `line ${i}\r\n`).join("")),
        1000,
      ),
    );
    await page.evaluate(() => window.ptyHarness.frame());

    const position = await page.evaluate(async () => {
      const terminal = document.querySelector<HTMLElement>("#terminal")!;
      terminal.scrollTop = 0;
      await window.ptyHarness.frame();
      const before = terminal.scrollTop;
      const textarea = terminal.querySelector("textarea")!;
      textarea.dispatchEvent(new CompositionEvent("compositionstart"));
      const inputRect = textarea.getBoundingClientRect();
      const cursorRect = terminal
        .querySelector<HTMLElement>(".term-cursor")!
        .getBoundingClientRect();
      return {
        before,
        after: terminal.scrollTop,
        bottom: terminal.scrollHeight - terminal.clientHeight,
        left: inputRect.left - cursorRect.left,
        top: inputRect.top - cursorRect.top,
      };
    });
    expect(position.before).toBe(0);
    expect(position.bottom).toBeGreaterThan(0);
    expect(position.after).toBe(position.bottom);
    expect(Math.abs(position.left)).toBeLessThan(1);
    expect(Math.abs(position.top)).toBeLessThan(1);
  });
}

test("Chromium shows native IME composition before forwarding its commit", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP IME events require Chromium");
  await page.goto("/?core=builtin&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  const textarea = page.locator("#terminal textarea");
  await textarea.focus();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "にほんご",
    selectionStart: 4,
    selectionEnd: 4,
  });
  await expect(textarea).toHaveValue("にほんご");
  expect(await textarea.evaluate((el) => getComputedStyle(el).opacity)).toBe(
    "1",
  );
  expect(
    await page.evaluate(() => window.ptyHarness.snapshot().responses),
  ).toEqual([]);

  await cdp.send("Input.insertText", { text: "日本語" });
  await expect(textarea).toHaveValue("");
  expect(await textarea.evaluate((el) => getComputedStyle(el).opacity)).toBe(
    "0",
  );
  expect(
    await page.evaluate(() => window.ptyHarness.snapshot().responses),
  ).toEqual(["日本語"]);
});
