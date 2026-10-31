import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });

for (const core of ["builtin", "ghostty"]) {
  test(`${core} keeps touch input at the cursor and accepts native edits`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query === "(pointer: coarse)"
          ? ({ matches: true, media: query } as MediaQueryList)
          : originalMatchMedia(query);
    });
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(20, 5));
    await page.evaluate(() =>
      window.ptyHarness.replayWrite(btoa("\x1b[?2004h\x1b[3;6H"), 1),
    );
    await page.evaluate(() => window.ptyHarness.frame());

    const placement = await page.evaluate(() => {
      const terminal = document.querySelector<HTMLElement>("#terminal")!;
      const textarea = terminal.querySelector("textarea")!;
      const cursor = terminal.querySelector<HTMLElement>(".term-cursor")!;
      const inputRect = textarea.getBoundingClientRect();
      const cursorRect = cursor.getBoundingClientRect();
      const style = getComputedStyle(textarea);
      return {
        left: inputRect.left - cursorRect.left,
        top: inputRect.top - cursorRect.top,
        width: inputRect.width,
        height: inputRect.height,
        cursorWidth: cursorRect.width,
        cursorHeight: cursorRect.height,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        value: textarea.value,
      };
    });
    expect(Math.abs(placement.left)).toBeLessThan(1);
    expect(Math.abs(placement.top)).toBeLessThan(1);
    expect(placement.width).toBeCloseTo(placement.cursorWidth, 0);
    expect(placement.height).toBeCloseTo(placement.cursorHeight, 0);
    expect(placement.opacity).toBe("1");
    expect(placement.pointerEvents).toBe("auto");
    expect(placement.value).toBe("\u200b");

    const textarea = page.locator("#terminal textarea");
    await textarea.evaluate((element) =>
      (element as HTMLTextAreaElement).blur(),
    );
    const target = await textarea.boundingBox();
    expect(target).not.toBeNull();
    await page.touchscreen.tap(
      target!.x + target!.width / 2,
      target!.y + target!.height / 2,
    );
    await expect(textarea).toBeFocused();

    const edits = await page.evaluate(() => {
      const textarea =
        document.querySelector<HTMLTextAreaElement>("#terminal textarea")!;
      const keydown = new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        bubbles: true,
        cancelable: true,
      });
      textarea.dispatchEvent(keydown);
      for (let i = 0; i < 3; i++) {
        textarea.value = "";
        textarea.dispatchEvent(
          new InputEvent("input", {
            inputType: "deleteContentBackward",
            bubbles: true,
          }),
        );
      }
      const unidentified = new KeyboardEvent("keydown", {
        key: "Unidentified",
        bubbles: true,
        cancelable: true,
      });
      textarea.dispatchEvent(unidentified);
      textarea.value = "\u200bhello";
      textarea.dispatchEvent(
        new InputEvent("input", { inputType: "insertText", bubbles: true }),
      );
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      textarea.dispatchEvent(paste);
      textarea.value = "\u200bpasted";
      textarea.dispatchEvent(
        new InputEvent("input", {
          inputType: "insertFromPaste",
          bubbles: true,
        }),
      );
      return {
        backspacePrevented: keydown.defaultPrevented,
        unidentifiedPrevented: unidentified.defaultPrevented,
        pastePrevented: paste.defaultPrevented,
        value: textarea.value,
        responses: window.ptyHarness.snapshot().responses,
      };
    });
    expect(edits.backspacePrevented).toBe(false);
    expect(edits.unidentifiedPrevented).toBe(false);
    expect(edits.pastePrevented).toBe(false);
    expect(edits.value).toBe("\u200b");
    expect(edits.responses).toEqual([
      "\x7f",
      "\x7f",
      "\x7f",
      "hello",
      "\x1b[200~pasted\x1b[201~",
    ]);

    await page.keyboard.press("Backspace");
    expect(
      await page.evaluate(() => window.ptyHarness.snapshot().responses),
    ).toEqual([...edits.responses, "\x7f"]);
    await expect(textarea).toHaveValue("\u200b");
  });
}
