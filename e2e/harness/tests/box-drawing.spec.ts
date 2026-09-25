import { expect, test, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.evaluate(
    (data) => window.ptyHarness.replayWrite(data, 1),
    Buffer.from(text).toString("base64"),
  );
  await page.evaluate(() => window.ptyHarness.frame());
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
      const vertical = Array.from(rows)
        .slice(0, 3)
        .map((row) =>
          Array.from(row.querySelectorAll("span")).find(
            (span) => span.textContent === "│",
          ),
        )
        .map((span) => span!.getBoundingClientRect());
      const horizontal = Array.from(rows[3].querySelectorAll("span"))
        .filter((span) => span.textContent === "─")
        .map((span) => span.getBoundingClientRect());
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
}
