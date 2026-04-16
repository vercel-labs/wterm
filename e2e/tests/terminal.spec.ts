import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".wterm .term-grid .term-row");
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
  test("generates scrollback after enough output", async ({ page }) => {
    const terminal = page.locator(".wterm");
    await terminal.click();

    for (let i = 0; i < 5; i++) {
      await page.keyboard.type(
        `for i in $(seq 1 20); do echo "line $i batch ${i}"; done`,
        { delay: 5 },
      );
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
    }

    await expect(terminal).toHaveClass(/has-scrollback/, { timeout: 5000 });
    const scrollbackRows = page.locator(".term-scrollback-row");
    expect(await scrollbackRows.count()).toBeGreaterThan(0);
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
