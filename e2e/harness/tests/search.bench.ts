import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  SEARCH_COLS,
  SEARCH_ROWS,
  SEARCH_HISTORY_BYTES,
  SEARCH_QUERIES,
  searchLine,
  searchMatchCount,
} from "../src/search-workload";
import { attachReport } from "./report";
import { collectBrowserErrors } from "./browser-errors";

const profile = process.env.WTERM_SEARCH_PROFILE ?? "smoke";
if (!["smoke", "stress"].includes(profile))
  throw new Error("WTERM_SEARCH_PROFILE must be smoke or stress");
const lines = profile === "stress" ? 100000 : 10000;
const fixtureHash = createHash("sha256");
for (let row = 0; row < lines; row++)
  fixtureHash.update(searchLine(row, lines) + "\r\n");
const fixtureSha256 = fixtureHash.digest("hex");
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  searchScriptSha256: createHash("sha256")
    .update(
      readFileSync(
        new URL("../../../packages/@wterm/dom/dist/search.js", import.meta.url),
      ),
    )
    .digest("hex"),
  ghosttyWasmSha256: createHash("sha256")
    .update(
      readFileSync(
        new URL(
          "../../../packages/@wterm/ghostty/wasm/ghostty-vt.wasm",
          import.meta.url,
        ),
      ),
    )
    .digest("hex"),
};

for (const query of SEARCH_QUERIES) {
  test(`ghostty ${query} history search`, async ({
    page,
    browser,
  }, testInfo) => {
    const browserErrors = collectBrowserErrors(page);
    let host: unknown;
    try {
      await page.goto(`/search.html?lines=${lines}`);
      await expect(page.locator("#status")).toHaveText("Ready", {
        timeout: 60000,
      });
      host = await (await page.request.get("/health")).json();
      expect(host).toMatchObject({ activePtys: 0, serving: "production" });
      const report = await page.evaluate(
        (value) => window.terminalSearch.run(value),
        query,
      );
      expect(report.error).toBeNull();
      expect(report.complete).toBe(true);
      expect(report.retainedRows).toBe(lines + 1);
      expect(report.discardedRows).toBe(0);
      expect(report.state).toMatchObject({
        query,
        count: query === "Needle" ? searchMatchCount(lines) : 0,
        searching: false,
        limited: false,
      });
      expect(report.completeMs).toBeGreaterThan(0);
      expect(report.mountedRows).toBeLessThan(200);
      if (query === "Needle") {
        expect(report.firstResultsMs).toBeGreaterThanOrEqual(0);
        expect(report.firstResultsMs).toBeLessThanOrEqual(report.completeMs!);
        expect(report.firstHighlightFrameMs).toBeGreaterThanOrEqual(
          report.firstResultsMs!,
        );
        await expect(page.locator(".term-search-active")).toBeVisible();
      } else {
        expect(report.firstResultsMs).toBeNull();
        expect(report.firstHighlightFrameMs).toBeNull();
      }
      expect(report.frames.count).toBeGreaterThan(0);
      for (const sample of [report.frames, report.taskDelay])
        if (sample.count) expect(Number.isFinite(sample.max)).toBe(true);
      expect(browserErrors.errors).toEqual([]);
    } finally {
      await attachReport(testInfo, "search.json", {
        profile,
        lines,
        query,
        cols: SEARCH_COLS,
        rows: SEARCH_ROWS,
        historyBytes: SEARCH_HISTORY_BYTES,
        fixtureSha256,
        source,
        host,
        browser: browser.version(),
        headless: testInfo.project.use.headless ?? true,
        browserErrors,
        project: testInfo.project.name,
        repeat: testInfo.repeatEachIndex,
        measurement: !page.isClosed()
          ? await page
              .evaluate(() => {
                window.terminalSearch?.abort(
                  "Automation ended before completion",
                );
                return window.terminalSearch?.report() ?? null;
              })
              .catch(() => null)
          : null,
      });
    }
  });
}

for (const failure of ["abort", "hidden"] as const) {
  test(`search measurement handles ${failure} and stops pending work`, async ({
    page,
  }) => {
    await page.goto("/search.html?lines=10000");
    await expect(page.locator("#status")).toHaveText("Ready");
    const result = await page.evaluate(async (failure) => {
      const pending = window.terminalSearch.run("Needle");
      if (failure === "abort") window.terminalSearch.abort("Cancelled by host");
      else {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }
      const report = structuredClone(await pending);
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        report,
        after: window.terminalSearch.report(),
        state: window.terminalSearch.state(),
      };
    }, failure);
    expect(result.report).toMatchObject({
      complete: false,
      error: failure === "abort" ? "Cancelled by host" : "Page became hidden",
      completeMs: null,
    });
    expect(result.after).toEqual(result.report);
    expect(result.state).toMatchObject({
      query: "",
      count: 0,
      searching: false,
    });
    await expect(page.locator(".term-search-match")).toHaveCount(0);
  });
}

test("search completes without MessageChannel", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "MessageChannel", { value: undefined });
  });
  await page.goto("/search.html?lines=10000");
  await expect(page.locator("#status")).toHaveText("Ready");
  const report = await page.evaluate(() => window.terminalSearch.run("Needle"));
  expect(report).toMatchObject({
    complete: true,
    error: null,
    state: { count: searchMatchCount(10000), searching: false },
  });
  await expect(page.locator(".term-search-active")).toBeVisible();
});
