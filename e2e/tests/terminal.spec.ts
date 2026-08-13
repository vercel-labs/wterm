import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?debug");
  await expect(page.locator(".wterm")).toContainText("Welcome to wterm!");
});

test.describe("rendering", () => {
  test("creates terminal structure", async ({ page }) => {
    await expect(page.locator(".wterm")).toBeVisible();
    await expect(page.locator(".term-grid")).toBeVisible();
    const rows = page.locator(".term-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("displays greeting text", async ({ page }) => {
    await expect(page.locator(".wterm")).toContainText("Welcome to wterm!");
  });

  test("keeps cursor-addressed redraws aligned after wide characters", async ({
    page,
  }) => {
    const terminal = page.locator(".wterm");
    await terminal.click();

    await page.keyboard.type(
      'printf "\\033[2J\\033[H\\360\\237\\223\\201abcd\\033[1;4Hx"',
      { delay: 5 },
    );
    await page.keyboard.press("Enter");

    await expect(terminal).toContainText("📁axcd", { timeout: 5000 });
    await expect(terminal).not.toContainText("📁abxd");
    await expect(
      terminal.locator(".term-wide").filter({ hasText: "📁" }),
    ).toHaveCount(1);
  });

  test("reveals OSC 8 hyperlink decoration on hover", async ({ page }) => {
    await page.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          __wterm: { write: (data: string) => void };
        }
      ).__wterm.write("\x1b]8;;https://wterm.dev\x1b\\wterm.dev\x1b]8;;\x1b\\");
    });

    const link = page.locator("a.term-link", { hasText: "wterm.dev" });
    await expect(link).toHaveAttribute("href", "https://wterm.dev/");
    await expect(link.locator("span")).toHaveCSS(
      "text-decoration-line",
      "none",
    );
    await link.hover();
    await expect(link.locator("span")).toHaveCSS(
      "text-decoration-line",
      "none",
    );
    const modifier = await page.evaluate(() =>
      navigator.platform.startsWith("Mac") ? "Meta" : "Control",
    );
    await page.keyboard.down(modifier);
    await expect(link.locator("span")).toHaveCSS(
      "text-decoration-line",
      "underline",
    );
    await expect(link).toHaveCSS("cursor", "pointer");
    await page.keyboard.up(modifier);
    await expect(link.locator("span")).toHaveCSS(
      "text-decoration-line",
      "none",
    );

    const activation = await link.evaluate((element) => {
      const dispatch = (init: MouseEventInit) => {
        const event = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
          ...init,
        });
        return {
          dispatched: element.dispatchEvent(event),
          defaultPrevented: event.defaultPrevented,
        };
      };
      return {
        isMac: navigator.platform.startsWith("Mac"),
        plain: dispatch({}),
        meta: dispatch({ metaKey: true }),
        control: dispatch({ ctrlKey: true }),
      };
    });
    expect(activation.plain).toEqual({
      dispatched: false,
      defaultPrevented: true,
    });
    expect(activation.meta).toEqual({
      dispatched: activation.isMac,
      defaultPrevented: !activation.isMac,
    });
    expect(activation.control).toEqual({
      dispatched: !activation.isMac,
      defaultPrevented: activation.isMac,
    });

    const mouseOwnership = await link.evaluate((element) => {
      const scope = globalThis as typeof globalThis & {
        __wterm: {
          onData: ((data: string) => void) | null;
          write: (data: string) => void;
        };
      };
      scope.__wterm.write("\x1b[?1000h\x1b[?1006h");
      const received: string[] = [];
      scope.__wterm.onData = (data) => received.push(data);
      const rect = element.getBoundingClientRect();
      const init = {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: rect.left + 2,
        clientY: rect.top + 2,
        cancelable: true,
      };

      element.dispatchEvent(
        new MouseEvent("mousedown", { ...init, metaKey: true }),
      );
      const afterMeta = [...received];
      element.dispatchEvent(
        new MouseEvent("mousedown", { ...init, ctrlKey: true }),
      );
      const afterControl = [...received];
      element.dispatchEvent(new MouseEvent("mousedown", init));

      return {
        isMac: navigator.platform.startsWith("Mac"),
        afterMeta,
        afterControl,
        afterPlain: received,
      };
    });
    const metaReports = mouseOwnership.afterMeta.length;
    const controlReports =
      mouseOwnership.afterControl.length - mouseOwnership.afterMeta.length;
    expect(mouseOwnership.isMac ? metaReports : controlReports).toBe(0);
    expect(mouseOwnership.isMac ? controlReports : metaReports).toBe(1);
    expect(
      mouseOwnership.afterPlain.length - mouseOwnership.afterControl.length,
    ).toBe(1);
    expect(mouseOwnership.afterPlain[1]).toMatch(/^\x1b\[<0;\d+;\d+M$/);
  });
});

test.describe("keyboard input", () => {
  test("typing a command produces output", async ({ page }) => {
    const terminal = page.locator(".wterm");
    await expect(terminal).toContainText("$", { timeout: 5000 });
    await terminal.click();

    await page.keyboard.type("echo hello", { delay: 30 });
    await expect(terminal).toContainText("echo hello");

    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("hello", { timeout: 5000 });
  });

  test("backspace removes characters", async ({ page }) => {
    const terminal = page.locator(".wterm");
    await expect(terminal).toContainText("$", { timeout: 5000 });
    await terminal.click();

    await page.keyboard.type("abc", { delay: 30 });
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("xy", { delay: 30 });
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("axy");
  });
});

test.describe("focus behavior", () => {
  test("clicking terminal adds focused class", async ({ page }) => {
    const terminal = page.locator(".wterm");
    await terminal.click();
    await expect(terminal).toHaveClass(/focused/);
  });

  test("clicking outside removes focused class", async ({ page }) => {
    const terminal = page.locator(".wterm");
    await terminal.click();
    await expect(terminal).toHaveClass(/focused/);

    await page.locator("body").click({ position: { x: 0, y: 0 } });
    await expect(terminal).not.toHaveClass(/focused/);
  });

  test("Tab key reaches the terminal", async ({ page }) => {
    await page.locator("body").click({ position: { x: 0, y: 0 } });
    await page.keyboard.press("Tab");
    await expect(page.locator(".wterm")).toHaveClass(/focused/);
  });
});

test.describe("cursor", () => {
  test("cursor element is present", async ({ page }) => {
    await expect(page.locator(".term-cursor")).toBeVisible();
  });

  test("cursor moves after typing", async ({ page }) => {
    const terminal = page.locator(".wterm");
    await terminal.click();

    const cursor = page.locator(".term-cursor");
    await expect(cursor).toBeVisible();
    const before = await cursor.boundingBox();
    expect(before).not.toBeNull();

    await page.keyboard.type("abc", { delay: 30 });
    await page.waitForTimeout(100);

    const after = await cursor.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.x).toBeGreaterThan(before!.x);
  });
});

test.describe("scrollback", () => {
  test("applies one scroll adjustment when old rows are discarded across frames", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const term = (
        globalThis as typeof globalThis & {
          __wterm: {
            element: HTMLElement;
            bridge: {
              getScrollbackDiscardedCount?: () => number;
            } | null;
            write: (data: string) => void;
          };
        }
      ).__wterm;
      const scroller = term.element;
      const lines = Array.from({ length: 1040 }, (_, index) => {
        const label = `history ${String(index).padStart(4, "0")}`;
        return `\x1b]8;;https://example.com/${index}\x1b\\${label}\x1b]8;;\x1b\\\r\n`;
      }).join("");
      term.write(lines);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      scroller.scrollTop = 6000;
      scroller.dispatchEvent(new Event("scroll"));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      const firstVisible = () => {
        const top = scroller.getBoundingClientRect().top;
        return (
          Array.from(
            scroller.querySelectorAll<HTMLElement>(".term-scrollback-row"),
          ).find((row) => row.getBoundingClientRect().bottom > top)
            ?.textContent ?? null
        );
      };
      const beforeScrollTop = scroller.scrollTop;
      const beforeRow = firstVisible();
      const beforeDiscarded = term.bridge?.getScrollbackDiscardedCount?.() ?? 0;
      const measuredRow = scroller.querySelector<HTMLElement>(
        ".term-scrollback-row",
      );
      if (!measuredRow) throw new Error("missing rendered scrollback row");
      const rowHeight = measuredRow.getBoundingClientRect().height;

      for (let index = 0; index < 40; index++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            term.write(`next ${index}\r\n`);
            resolve();
          }),
        );
      }

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const afterDiscarded =
        term.bridge?.getScrollbackDiscardedCount?.() ?? beforeDiscarded;
      return {
        after: scroller.scrollTop,
        expected:
          beforeScrollTop - (afterDiscarded - beforeDiscarded) * rowHeight,
        beforeRow,
        afterRow: firstVisible(),
      };
    });

    expect(result.after).toBe(result.expected);
    expect(result.afterRow).toBe(result.beforeRow);
  });

  test("bounds DOM rows and follows output at the exact bottom", async ({
    page,
  }) => {
    const terminal = page.locator(".wterm");
    await terminal.click();

    await page.keyboard.type(
      'for i in $(seq 1 1200); do echo "scrollback line $i"; done',
      { delay: 1 },
    );
    await page.keyboard.press("Enter");

    await expect(terminal).toHaveClass(/has-scrollback/, { timeout: 5000 });
    await expect(terminal).toContainText("scrollback line 1200", {
      timeout: 5000,
    });
    const scrollbackRows = page.locator(".term-scrollback-row");
    await expect
      .poll(() => scrollbackRows.count(), { timeout: 5000 })
      .toBeLessThan(100);
    expect(await scrollbackRows.count()).toBeGreaterThan(0);

    const bottomDistance = await terminal.evaluate(
      (element) =>
        element.scrollHeight - element.scrollTop - element.clientHeight,
    );
    expect(bottomDistance).toBeLessThanOrEqual(1);
  });

  test("returns to the bottom when the user types while reading history", async ({
    page,
  }) => {
    const terminal = page.locator(".wterm");
    await terminal.click();
    await page.keyboard.type(
      'for i in $(seq 1 200); do echo "history line $i"; done',
      { delay: 1 },
    );
    await page.keyboard.press("Enter");
    await expect(terminal).toHaveClass(/has-scrollback/, { timeout: 5000 });

    await terminal.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect
      .poll(() => terminal.evaluate((element) => element.scrollTop))
      .toBe(0);

    await page.keyboard.type("echo back-at-bottom", { delay: 1 });

    const bottomDistance = await terminal.evaluate(
      (element) =>
        element.scrollHeight - element.scrollTop - element.clientHeight,
    );
    expect(bottomDistance).toBeLessThanOrEqual(1);
  });

  test("keeps the same history row anchored across resize", async ({
    page,
  }) => {
    const terminal = page.locator(".wterm");
    await terminal.click();
    await page.keyboard.type(
      'for i in $(seq 1 400); do echo "resize history $i"; done',
      { delay: 1 },
    );
    await page.keyboard.press("Enter");
    await expect(terminal).toHaveClass(/has-scrollback/, { timeout: 5000 });
    await expect(terminal).toContainText("resize history 400", {
      timeout: 5000,
    });

    await terminal.evaluate(async (element) => {
      element.scrollTop = 600;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await expect
      .poll(() => terminal.evaluate((element) => element.scrollTop))
      .toBe(600);

    const firstVisibleText = () =>
      terminal.evaluate((element) => {
        const top = element.getBoundingClientRect().top + 12;
        const row = Array.from(
          element.querySelectorAll<HTMLElement>(".term-scrollback-row"),
        ).find((candidate) => candidate.getBoundingClientRect().bottom > top);
        return row?.textContent ?? null;
      });
    const before = await firstVisibleText();
    expect(before).not.toBeNull();

    await page.setViewportSize({ width: 1280, height: 500 });

    await expect.poll(firstVisibleText).toBe(before);
  });
});

test.describe("resize", () => {
  test("terminal re-renders on viewport resize", async ({ page }) => {
    const terminal = page.locator(".wterm");
    await terminal.click();
    await expect(terminal).toContainText("Welcome to wterm!");

    const rowCountSelector = ".term-row:not(.term-scrollback-row)";
    const rowsBefore = await page.locator(rowCountSelector).count();
    await page.setViewportSize({ width: 800, height: 200 });
    await page.waitForTimeout(500);
    const rowsAfter = await page.locator(rowCountSelector).count();

    expect(rowsAfter).toBeLessThan(rowsBefore);
  });
});
