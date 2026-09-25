import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { protocolFixtures } from "../../fixtures/protocol";
import type { ReplayFixture } from "../../fixtures/types";
import { attachReport } from "./report";

const recordings: ReplayFixture[] = ["neovim-edit", "tmux-pane"].map((id) =>
  JSON.parse(
    readFileSync(new URL(`../../fixtures/${id}.json`, import.meta.url), "utf8"),
  ),
);

for (const core of ["builtin", "ghostty"]) {
  for (const fixture of [...recordings, ...protocolFixtures]) {
    test(`${core} replays ${fixture.id}`, async ({
      page,
      browser,
    }, testInfo) => {
      await page.goto(`/?core=${core}&mode=replay`);
      await expect(page.locator("#status")).toHaveText("Replay ready");
      const health = await (await page.request.get("/health")).json();
      expect(health.activePtys).toBe(0);
      await page.evaluate(
        ({ cols, rows }) => window.ptyHarness.resize(cols, rows),
        fixture,
      );
      const checkpoints: unknown[] = [];
      const chunkBytes = fixture.source.kind === "protocol" ? 1 : 7;
      try {
        let previousTime = 0;
        for (const event of fixture.events) {
          expect(event.atMs).toBeGreaterThanOrEqual(previousTime);
          previousTime = event.atMs;
          if (event.type === "output") {
            await page.evaluate(
              ({ data, chunkBytes }) =>
                window.ptyHarness.replayWrite(data, chunkBytes),
              { data: event.data, chunkBytes },
            );
          } else if (event.type === "resize") {
            await page.evaluate(
              ({ cols, rows }) => window.ptyHarness.resize(cols, rows),
              event,
            );
          } else if (event.type === "checkpoint") {
            await test.step(event.name, async () => {
              await page.evaluate(() => window.ptyHarness.frame());
              const actual = await page.evaluate(() => ({
                ...window.ptyHarness.snapshot(),
                renderedRows: Array.from(
                  document.querySelectorAll(
                    ".term-row:not(.term-scrollback-row)",
                  ),
                  (row) => row.textContent?.trimEnd() ?? "",
                ),
              }));
              checkpoints.push({
                name: event.name,
                expected: event.expected,
                actual,
              });
              const { rows, cells, renderedRows, styles, ...rest } =
                event.expected;
              expect(actual).toMatchObject(rest);
              for (const [row, text] of Object.entries(rows ?? {})) {
                expect(actual.rows[Number(row)], `core row ${row}`).toBe(text);
              }
              for (const [row, text] of Object.entries(
                renderedRows ?? rows ?? {},
              )) {
                expect(
                  actual.renderedRows[Number(row)],
                  `rendered row ${row}`,
                ).toBe(text);
              }
              for (const { row, col, value } of cells ?? []) {
                expect(
                  actual.cells[row][col],
                  `cell ${row},${col}`,
                ).toMatchObject(value);
              }
              for (const { row, text, color, fontWeight } of styles ?? []) {
                const span = page
                  .locator(".term-row:not(.term-scrollback-row)")
                  .nth(row)
                  .locator("span")
                  .filter({ hasText: text })
                  .first();
                await expect(span).toHaveCSS("color", color);
                await expect(span).toHaveCSS("font-weight", fontWeight);
              }
            });
          }
          // Input events document how the recording was made. They are never
          // executed: only the recorded PTY output reaches the terminal.
        }
        expect(checkpoints.length).toBeGreaterThan(0);
        const report = await page.evaluate(() => window.ptyHarness.report());
        expect(report.outputBytes).toBe(
          fixture.events.reduce(
            (sum, event) =>
              sum +
              (event.type === "output"
                ? Buffer.from(event.data, "base64").length
                : 0),
            0,
          ),
        );
      } finally {
        if (!page.isClosed()) {
          await page.evaluate(() => window.ptyHarness.frame());
          await attachReport(testInfo, "replay-baseline.json", {
            test: testInfo.title,
            project: testInfo.project.name,
            browser: browser.version(),
            fixture: fixture.id,
            fixtureSha256: createHash("sha256")
              .update(JSON.stringify(fixture))
              .digest("hex"),
            capture: fixture.source,
            chunkBytes,
            playback: "ordered, without capture delays",
            host: health,
            ...(await page.evaluate(() => window.ptyHarness.report())),
            checkpoints,
          });
        }
      }
    });
  }
}
