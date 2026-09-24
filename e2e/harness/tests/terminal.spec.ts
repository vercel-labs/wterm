import { expect, test } from "@playwright/test";
import { attachReport } from "./report";

for (const core of ["builtin", "ghostty"]) {
  test.describe(core, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/?core=${core}`);
      await expect(page.locator("#status")).toHaveText("Connected · /bin/sh");
      await expect(page.locator("#terminal")).toContainText("wterm$");
      await page.locator("#terminal").click();
    });

    test.afterEach(async ({ page, browser }, testInfo) => {
      if (!page.isClosed()) {
        const report = await page.evaluate(() => window.ptyHarness?.report());
        if (report) {
          await attachReport(testInfo, "pty-baseline.json", {
            test: testInfo.title,
            project: testInfo.project.name,
            browser: browser.version(),
            ...report,
          });
        }
      }
    });

    test("executes browser keystrokes in a real PTY and measures a round trip", async ({
      page,
    }) => {
      // The expected markers never occur in the echoed input: the shell must
      // execute the commands, and both stdin and stdout must be terminals.
      await page.keyboard.type(
        "printf '\\033[2J\\033[H\\033[32mPTY_%s\\033[0m\\n' ROUNDTRIP; test -t 0 && test -t 1 && printf 'TTY_%s\\n' OK",
      );
      await page.keyboard.press("Enter");
      await expect(
        page.locator(".term-row").filter({ hasText: /^PTY_ROUNDTRIP\s*$/ }),
      ).toHaveCount(1);
      await expect(page.locator("#terminal")).toContainText("TTY_OK");
      const snapshot = await page.evaluate(() => window.ptyHarness.snapshot());
      expect(snapshot.rows[0]).toBe("PTY_ROUNDTRIP");
      expect(snapshot.cols).toBe(80);
      expect(snapshot.height).toBe(24);

      await page.getByRole("button", { name: "Run round trip" }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.ptyHarness.report().timings.roundTripToFrameMs.count,
          ),
        )
        .toBe(1);
      const report = await page.evaluate(() => window.ptyHarness.report());
      expect(report.core).toBe(core);
      expect(report.outputBytes).toBeGreaterThan(0);
      expect(report.timings.writeMs.count).toBeGreaterThan(0);
      expect(report.timings.receiveToFrameMs.count).toBeGreaterThan(0);
      expect(report.timings.roundTripToFrameMs.p50).toBeGreaterThanOrEqual(0);
      // Performance budgets require controlled hardware; this smoke test
      // validates the measurement path without asserting a latency SLA.
    });

    test("forwards terminal dimensions to the PTY", async ({ page }) => {
      await page.evaluate(() => window.ptyHarness.resize(100, 30));
      await page.keyboard.type("printf 'SIZE_'; stty size");
      await page.keyboard.press("Enter");
      await expect(page.locator("#terminal")).toContainText("SIZE_30 100");
      const snapshot = await page.evaluate(() => window.ptyHarness.snapshot());
      expect(snapshot.cols).toBe(100);
      expect(snapshot.height).toBe(30);
    });

    test("reports shell exit and releases the PTY", async ({
      page,
      request,
    }) => {
      await page.keyboard.type("exit 7");
      await page.keyboard.press("Enter");
      await expect(page.locator("#status")).toHaveText("Shell exited (7)");
      await expect
        .poll(
          async () => (await (await request.get("/health")).json()).activePtys,
        )
        .toBe(0);
      await expect(
        page.getByRole("button", { name: "Run round trip" }),
      ).toBeDisabled();
    });
  });
}
