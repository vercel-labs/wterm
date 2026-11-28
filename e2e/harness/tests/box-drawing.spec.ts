import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.evaluate(
    (data) => window.ptyHarness.replayWrite(data, 1),
    Buffer.from(text).toString("base64"),
  );
  await page.evaluate(() => window.ptyHarness.frame());
}

for (const scale of [1, 2]) {
  test.describe(`at device scale ${scale}`, () => {
    test.use({ deviceScaleFactor: scale });

    for (const core of ["builtin", "ghostty"]) {
      test(`${core} paints box rules without seams at fractional cell widths`, async ({
        page,
      }) => {
        await page.goto(`/?core=${core}&mode=replay`);
        await expect(page.locator("#status")).toHaveText("Replay ready");
        await page.evaluate(() => window.ptyHarness.resize(40, 8));
        // Hosts often reset every element to border-box sizing.
        await page.addStyleTag({
          content: "*, *::before, *::after { box-sizing: border-box; }",
        });
        await write(
          page,
          "\x1b[?25l\x1b[2;2H" +
            "─".repeat(30) +
            "X" +
            "\x1b[4;2H" +
            "━".repeat(30) +
            Array.from({ length: 6 }, (_, row) => `\x1b[${row + 2};36H│`).join(
              "",
            ),
        );

        const grid = page.locator(".term-grid");
        const geometry = await grid.evaluate((element) => {
          const gridRect = element.getBoundingClientRect();
          const rows = Array.from(element.querySelectorAll(".term-row"));
          const cells = (row: Element, ch: string) =>
            Array.from(row.querySelectorAll<HTMLElement>(".term-box"))
              .filter((span) => span.textContent === ch)
              .map((span) => span.getBoundingClientRect());
          const rule = (row: Element, ch: string) => {
            const spans = cells(row, ch);
            return {
              y: spans[0].top + spans[0].height / 2 - gridRect.top,
              left: spans[0].left - gridRect.left,
              right: spans.at(-1)!.right - gridRect.left,
            };
          };
          const bars = rows
            .slice(1, 7)
            .map((row) => cells(row, "│")[0])
            .filter(Boolean);
          return {
            cellWidth: parseFloat(
              getComputedStyle(element).getPropertyValue("--term-cell-width"),
            ),
            afterRule:
              Array.from(rows[1].querySelectorAll("span"))
                .find((span) => span.textContent?.startsWith("X"))!
                .getBoundingClientRect().left -
              rows[1].getBoundingClientRect().left,
            light: rule(rows[1], "─"),
            heavy: rule(rows[3], "━"),
            bar: {
              x: bars[0].left + bars[0].width / 2 - gridRect.left,
              top: bars[0].top - gridRect.top,
              bottom: bars.at(-1)!.bottom - gridRect.top,
            },
          };
        });
        // Seams come from cells that sit at fractional device-pixel offsets.
        // A whole-pixel cell width would pass without exercising the overlap.
        const fraction = (geometry.cellWidth * scale) % 1;
        expect(fraction).toBeGreaterThan(0.05);
        expect(fraction).toBeLessThan(0.95);
        // The cell after the rule stays in column 32.
        expect(
          Math.abs(geometry.afterRule - 31 * geometry.cellWidth),
        ).toBeLessThan(0.1);

        const screenshot = await grid.screenshot({ scale: "device" });
        const seams = await page.evaluate(
          async ({ png, scale, light, heavy, bar }) => {
            const image = new Image();
            image.src = `data:image/png;base64,${png}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(
              0,
              0,
              image.width,
              image.height,
            ).data;
            const brightness = (x: number, y: number) => {
              const i = (y * image.width + x) * 4;
              return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
            };
            // A seam is a pixel along the stroke that is much darker than
            // the rest of the stroke.
            const seamsIn = (samples: number[]) => {
              const sorted = [...samples].sort((a, b) => a - b);
              const median = sorted[Math.floor(sorted.length / 2)];
              return samples.flatMap((value, index) =>
                value < median * 0.8 ? [index] : [],
              );
            };
            const horizontal = (rule: typeof light) => {
              const samples: number[] = [];
              const y = Math.round(rule.y * scale);
              for (
                let x = Math.ceil(rule.left * scale) + 1;
                x < Math.floor(rule.right * scale) - 1;
                x++
              ) {
                let brightest = 0;
                for (let dy = -3 * scale; dy <= 3 * scale; dy++)
                  brightest = Math.max(brightest, brightness(x, y + dy));
                samples.push(brightest);
              }
              return seamsIn(samples);
            };
            const vertical = () => {
              const samples: number[] = [];
              const x = Math.round(bar.x * scale);
              for (
                let y = Math.ceil(bar.top * scale) + 1;
                y < Math.floor(bar.bottom * scale) - 1;
                y++
              ) {
                let brightest = 0;
                for (let dx = -2 * scale; dx <= 2 * scale; dx++)
                  brightest = Math.max(brightest, brightness(x + dx, y));
                samples.push(brightest);
              }
              return seamsIn(samples);
            };
            return {
              light: horizontal(light),
              heavy: horizontal(heavy),
              bar: vertical(),
            };
          },
          { png: screenshot.toString("base64"), scale, ...geometry },
        );
        expect(seams.light).toEqual([]);
        expect(seams.heavy).toEqual([]);
        expect(seams.bar).toEqual([]);
      });

      test(`${core} keeps every stroke in place when box cells overlap`, async ({
        page,
      }) => {
        await page.goto(`/?core=${core}&mode=replay`);
        await expect(page.locator("#status")).toHaveText("Replay ready");
        await page.evaluate(() => window.ptyHarness.resize(40, 4));
        // Cells at many fractional offsets, so rounding differs per column.
        await write(page, "\x1b[?25l\x1b[2;1H" + "─┤ ".repeat(12));

        const grid = page.locator(".term-grid");
        const tees = await grid.evaluate((element) => {
          const gridRect = element.getBoundingClientRect();
          return Array.from(element.querySelectorAll<HTMLElement>(".term-box"))
            .filter((span) => span.textContent === "┤")
            .map((span) => {
              const rect = span.getBoundingClientRect();
              return {
                left: rect.left - gridRect.left,
                right: rect.right - gridRect.left,
                top: rect.top - gridRect.top,
                height: rect.height,
              };
            });
        });
        expect(tees).toHaveLength(12);

        // Right edges of each ┤'s arm row and of its vertical stroke alone.
        const strokeEdges = async () => {
          const screenshot = await grid.screenshot({ scale: "device" });
          return page.evaluate(
            async ({ png, scale, tees }) => {
              const image = new Image();
              image.src = `data:image/png;base64,${png}`;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext("2d")!;
              context.drawImage(image, 0, 0);
              const pixels = context.getImageData(
                0,
                0,
                image.width,
                image.height,
              ).data;
              const brightness = (x: number, y: number) => {
                const i = (y * image.width + x) * 4;
                return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
              };
              const rightmostInk = (y: number, left: number, right: number) => {
                let last = -1;
                for (let x = left; x <= right; x++)
                  if (brightness(x, y) >= 100) last = x;
                return last;
              };
              return tees.map((tee) => {
                const left = Math.floor(tee.left * scale);
                const right = Math.ceil(tee.right * scale);
                const row = (fraction: number) =>
                  Math.round((tee.top + tee.height * fraction) * scale);
                return {
                  arm: rightmostInk(row(0.5), left, right),
                  bar: rightmostInk(row(0.25), left, right),
                };
              });
            },
            { png: screenshot.toString("base64"), scale, tees },
          );
        };

        const overlapped = await strokeEdges();
        await page.addStyleTag({
          content: ".term-box { margin: 0 !important; padding: 0 !important; }",
        });
        await page.evaluate(() => window.ptyHarness.frame());
        const separate = await strokeEdges();
        expect(overlapped).toEqual(separate);
      });
    }
  });
}

for (const core of ["builtin", "ghostty"]) {
  test(`${core} connects box-drawing strokes across cells`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(20, 6));
    await write(
      page,
      "\x1b[?25l\x1b[1;10H│\x1b[2;10H│\x1b[3;10H│\x1b[4;2H────────",
    );

    const grid = page.locator(".term-grid");
    // Emulate a fallback font whose box glyphs do not reach the cell edges.
    await grid.evaluate((element) => {
      for (const span of element.querySelectorAll<HTMLElement>("span")) {
        if (span.textContent === "│" || span.textContent === "─") {
          span.style.fontSize = "10px";
        }
      }
    });
    const geometry = await grid.evaluate((element) => {
      const gridRect = element.getBoundingClientRect();
      const rows = element.querySelectorAll(".term-row");
      // Measure the cell itself, not the half-pixel overlap around it.
      const cellRect = (span: HTMLElement) => {
        const rect = span.getBoundingClientRect();
        const style = getComputedStyle(span);
        const x = parseFloat(style.paddingLeft);
        const y = parseFloat(style.paddingTop);
        return new DOMRect(
          rect.left + x,
          rect.top + y,
          rect.width - 2 * x,
          rect.height - 2 * y,
        );
      };
      const vertical = Array.from(rows)
        .slice(0, 3)
        .map((row) =>
          Array.from(row.querySelectorAll("span")).find(
            (span) => span.textContent === "│",
          ),
        )
        .map((span) => cellRect(span!));
      const horizontal = Array.from(rows[3].querySelectorAll("span"))
        .filter((span) => span.textContent === "─")
        .map(cellRect);
      return {
        vertical: {
          x: vertical[0].left + vertical[0].width / 2 - gridRect.left,
          top: vertical[0].top - gridRect.top,
          bottom: vertical.at(-1)!.bottom - gridRect.top,
        },
        horizontal: {
          y: horizontal[0].top + horizontal[0].height / 2 - gridRect.top,
          left: horizontal[0].left - gridRect.left,
          right: horizontal.at(-1)!.right - gridRect.left,
        },
      };
    });
    const screenshot = await grid.screenshot({ scale: "css" });
    const gaps = await page.evaluate(
      async ({ png, vertical, horizontal }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const brightness = (x: number, y: number) => {
          const [r, g, b] = context.getImageData(x, y, 1, 1).data;
          return Math.max(r, g, b);
        };
        const verticalGaps: number[] = [];
        const horizontalGaps: number[] = [];
        for (let y = Math.ceil(vertical.top); y < vertical.bottom; y++) {
          let brightest = 0;
          for (
            let x = Math.floor(vertical.x) - 1;
            x <= Math.ceil(vertical.x) + 1;
            x++
          ) {
            brightest = Math.max(brightest, brightness(x, y));
          }
          if (brightest < 100) verticalGaps.push(y);
        }
        for (let x = Math.ceil(horizontal.left); x < horizontal.right; x++) {
          let brightest = 0;
          for (
            let y = Math.floor(horizontal.y) - 2;
            y <= Math.ceil(horizontal.y) + 2;
            y++
          ) {
            brightest = Math.max(brightest, brightness(x, y));
          }
          if (brightest < 100) horizontalGaps.push(x);
        }
        return { verticalGaps, horizontalGaps };
      },
      { png: screenshot.toString("base64"), ...geometry },
    );
    expect(gaps.verticalGaps).toEqual([]);
    expect(gaps.horizontalGaps).toEqual([]);
  });

  test(`${core} preserves box text, rounded corners, colors, and cursors`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(20, 5));
    await write(
      page,
      "\x1b[?25l\x1b[36m\x1b[1;2H╭────╮\x1b[2;2H│    │\x1b[3;2H╰────╯\x1b[4;2HX\x1b[1m┏━━┓\x1b[0m",
    );
    // Changing the glyph size must not change border geometry or copy text.
    await page.locator(".term-grid").evaluate((grid) => {
      for (const span of grid.querySelectorAll<HTMLElement>(".term-box")) {
        span.style.fontSize = "10px";
      }
    });

    const geometry = await page.locator(".term-grid").evaluate((grid) => {
      const firstRow = grid.querySelector(".term-row")!;
      const boxCells = Array.from(
        firstRow.querySelectorAll<HTMLElement>(".term-box"),
      );
      const range = document.createRange();
      range.setStartBefore(boxCells[0]);
      range.setEndAfter(boxCells.at(-1)!);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const selected = selection.toString();
      selection.removeAllRanges();

      const straight = boxCells[1];
      const rounded = boxCells[0];
      const heavy = grid
        .querySelectorAll(".term-row")[3]
        .querySelector<HTMLElement>(".term-box-heavy");
      const control = Array.from(
        grid.querySelectorAll(".term-row")[3].querySelectorAll("span"),
      ).find((span) => span.textContent === "X")!;
      return {
        selected,
        straightColor: getComputedStyle(straight).color,
        controlColor: getComputedStyle(control).color,
        straightImage: getComputedStyle(straight).backgroundImage,
        roundedText: rounded.textContent,
        roundedBorder: getComputedStyle(rounded, "::after").borderTopWidth,
        heavy: Boolean(heavy),
        bold: heavy?.classList.contains("term-box-bold") ?? false,
      };
    });
    expect(geometry.selected).toBe("╭────╮");
    expect(geometry.straightColor).toBe(geometry.controlColor);
    expect(geometry.straightImage).toContain("linear-gradient");
    expect(geometry.roundedText).toBe("╭");
    expect(parseFloat(geometry.roundedBorder)).toBeGreaterThan(0);
    expect(geometry.heavy).toBe(true);
    expect(geometry.bold).toBe(true);

    await write(page, "\x1b[?25h\x1b[2;2H");
    const cursor = page.locator(".term-cursor");
    await expect(cursor).toHaveText("│");
    const cursorStyle = await cursor.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        background: style.backgroundColor,
        image: style.backgroundImage,
      };
    });
    expect(cursorStyle.color).toBe("rgb(30, 30, 30)");
    expect(cursorStyle.background).toBe("rgb(174, 175, 173)");
    expect(cursorStyle.image).toContain("linear-gradient");

    await page.emulateMedia({ media: "print" });
    const printStyle = await cursor.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        fill: style.webkitTextFillColor,
        image: style.backgroundImage,
        corner: getComputedStyle(
          element.closest(".term-grid")!.querySelector(".term-box-round")!,
          "::after",
        ).display,
      };
    });
    expect(printStyle.fill).toBe(printStyle.color);
    expect(printStyle.image).toBe("none");
    expect(printStyle.corner).toBe("none");
  });

  test(`${core} keeps box-drawing corners and T-junctions flush without overshoot`, async ({
    page,
  }) => {
    await page.goto(`/?core=${core}&mode=replay`);
    await expect(page.locator("#status")).toHaveText("Replay ready");
    await page.evaluate(() => window.ptyHarness.resize(20, 5));
    await write(page, "\x1b[?25l\x1b[1;2H│   │   │\x1b[2;2H└───┴───┘");

    const grid = page.locator(".term-grid");
    const geometry = await grid.evaluate((element) => {
      const gridRect = element.getBoundingClientRect();
      const row = element.querySelectorAll(".term-row")[1];
      const spans = Array.from(row.querySelectorAll<HTMLElement>(".term-box"));
      const bar = spans.find((span) => span.textContent === "─")!;
      const stroke = parseFloat(
        getComputedStyle(bar).getPropertyValue("--term-box-stroke"),
      );
      const cellBox = (ch: string) => {
        const rect = spans
          .find((span) => span.textContent === ch)!
          .getBoundingClientRect();
        return {
          left: rect.left - gridRect.left,
          top: rect.top - gridRect.top,
          width: rect.width,
          height: rect.height,
        };
      };
      return {
        stroke,
        bar: cellBox("─"),
        bl: cellBox("└"),
        tee: cellBox("┴"),
        br: cellBox("┘"),
      };
    });

    const screenshot = await grid.screenshot({ scale: "css" });
    const result = await page.evaluate(
      async ({ png, stroke, bar, bl, tee, br }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const brightness = (x: number, y: number) => {
          const [r, g, b] = context.getImageData(x, y, 1, 1).data;
          return Math.max(r, g, b);
        };

        const barCenterX = Math.floor(bar.left + bar.width / 2);
        let barBottom = -1;
        for (
          let y = Math.floor(bar.top);
          y < Math.ceil(bar.top + bar.height);
          y++
        ) {
          if (brightness(barCenterX, y) >= 100) barBottom = y;
        }

        const belowY = barBottom + 1;
        const belowBrightness = (box: { left: number; width: number }) =>
          brightness(Math.floor(box.left + box.width / 2), belowY);

        return {
          stroke,
          barBottom,
          blBelow: belowBrightness(bl),
          teeBelow: belowBrightness(tee),
          brBelow: belowBrightness(br),
        };
      },
      { png: screenshot.toString("base64"), ...geometry },
    );

    expect(result.barBottom).toBeGreaterThan(0);
    expect(result.blBelow).toBeLessThan(100);
    expect(result.teeBelow).toBeLessThan(100);
    expect(result.brBelow).toBeLessThan(100);
  });
}
