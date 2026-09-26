import { expect, test } from "@playwright/test";
import { collectBrowserErrors } from "./browser-errors";

test("records native resize deferrals without hiding application exceptions", async ({
  page,
  browserName,
}) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/input.html?core=builtin");
  await expect(page.locator("#status")).toHaveText("Ready");
  const before = errors.resizeObserverNotifications;
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.style.width = "10px";
    document.body.append(box);
    let notifications = 0;
    const observer = new ResizeObserver(() => {
      if (++notifications <= 2) box.style.width = `${10 + notifications}px`;
      else {
        observer.disconnect();
        box.remove();
      }
    });
    observer.observe(box);
  });
  // WebKit forwards this native diagnostic as a Playwright pageerror; the
  // other backends do not. Application exceptions are checked on every engine.
  if (browserName === "webkit") {
    await expect
      .poll(() => errors.resizeObserverNotifications)
      .toBeGreaterThan(before);
  }
  expect(errors.errors).toEqual([]);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("Application callback failed");
    }, 0);
  });
  await expect
    .poll(() => errors.errors)
    .toContain("Application callback failed");
});

for (const core of ["builtin", "ghostty"]) {
  test(`${core} probe waits for matching DOM before counting a frame`, async ({
    page,
  }) => {
    await page.goto(`/input.html?core=${core}&sessions=8`);
    await expect(page.locator("#status")).toHaveText("Ready");
    await page.evaluate(() => {
      window.terminalInput.start("redraw", 2);
    });
    await page.keyboard.press("a");
    await page.waitForFunction(
      () => window.terminalInput.progress().completed === 1,
    );
    await page.evaluate(() => {
      window.terminalInput.pause(true);
    });
    await page.keyboard.press("a");
    const pending = await page.evaluate(async () => {
      // Frame callbacks alone must never count an echo whose DOM is withheld.
      for (let i = 0; i < 4; i++)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      return window.terminalInput.progress();
    });
    expect(pending).toMatchObject({
      started: 2,
      completed: 1,
      pending: true,
      error: null,
    });
    await page.evaluate(() => window.terminalInput.pause(false));
    await page.waitForFunction(
      () => window.terminalInput.progress().completed === 2,
    );
    const report = await page.evaluate(() => window.terminalInput.finish());
    expect(report.complete).toBe(true);
    expect(report.probes.keyDispatchToDOMMs.count).toBe(2);
    const stopped = await page.evaluate(async () => {
      const grids = Array.from(
        document.querySelectorAll(".term-grid"),
        (grid) => grid.innerHTML,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        grids,
        after: Array.from(
          document.querySelectorAll(".term-grid"),
          (grid) => grid.innerHTML,
        ),
      };
    });
    expect(stopped.after).toEqual(stopped.grids);
  });

  for (const failure of [
    "timeout",
    "focus",
    "hidden",
    "overlap",
    "early finish",
  ] as const) {
    test(`${core} probe rejects ${failure} and stops producers`, async ({
      page,
    }) => {
      await page.goto(`/input.html?core=${core}&sessions=8`);
      await expect(page.locator("#status")).toHaveText("Ready");
      await page.evaluate(() => {
        window.terminalInput.start("ansi", 2);
        window.terminalInput.pause(true);
      });
      await page.keyboard.press("a");
      if (failure === "focus")
        await page
          .locator("textarea")
          .first()
          .evaluate((input) => input.blur());
      if (failure === "overlap") await page.keyboard.press("b");
      if (failure === "early finish")
        await page.evaluate(() => window.terminalInput.finish());
      if (failure === "hidden")
        await page.evaluate(() => {
          // Deterministic visibility-state injection exercises the hidden-tab guard.
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      await page.waitForFunction(
        () => window.terminalInput.progress().stopped,
        undefined,
        { timeout: 8000 },
      );
      const report = await page.evaluate(() => window.terminalInput.report());
      expect(report?.complete).toBe(false);
      expect(report?.probes.completed).toBe(0);
      const errors = {
        timeout: "within 5 seconds",
        focus: "lost focus",
        hidden: "became hidden",
        overlap: "Overlapping",
        "early finish": "without all expected echoes",
      };
      expect(report?.error).toContain(errors[failure]);
      // Unpause after stopping: producer writes must not continue in the core.
      const stable = await page.evaluate(async () => {
        Reflect.deleteProperty(document, "visibilityState");
        document.dispatchEvent(new Event("visibilitychange"));
        window.terminalInput.pause(false);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const grid = document.querySelector(".term-grid")!;
        const before = grid.innerHTML;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          before,
          after: grid.innerHTML,
          progress: window.terminalInput.progress(),
        };
      });
      expect(stable.after).toBe(stable.before);
      expect(stable.progress.completed).toBe(0);
    });
  }
}
