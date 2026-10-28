import { expect, test } from "@playwright/test";

// Pieces of terminal output mixed at random: styles, links, scrollback, its
// clears and a lowered line limit, titles, replies (including a flood larger than one parsing chunk),
// the alternate screen, and multi-code-point clusters.
const PIECES = [
  "plain text ",
  "\x1b[1;31mred\x1b[0m ",
  "\x1b[38;2;10;200;30mtrue\x1b[0m",
  "\x1b[48;5;208m bg \x1b[m",
  "\x1b]8;;https://a.test\x07link\x1b]8;;\x07",
  "\x1b]8;id=x;https://b.test\x07idlink\x1b]8;;\x07",
  "\r\n",
  "\r\n\r\n\r\n",
  "\x1b[5;10H",
  "\x1b[2J\x1b[H",
  "\x1b[K",
  "\x1b]0;title-",
  "\x07",
  "\x1b[6n",
  "\x1b[c",
  "\x1b[?1049h",
  "\x1b[?1049l",
  "\x1b[?2004h",
  "\x1b[?1000h\x1b[?1006h",
  "界語",
  "\u{1F600}",
  "é",
  "\u{1F468}‍\u{1F469}‍\u{1F467}",
  "\u{1F1EF}\u{1F1F5}",
  "\x1b[4mund\x1b[24m",
  "\x1b[7mrev\x1b[27m",
  "\t|",
  "\x1b[3D",
  "\x1b[3J",
  "\x1b[3J" + "line\r\n".repeat(40),
  "\x1b[6n".repeat(500),
];

for (let seed = 1; seed <= 12; seed++) {
  test(`WorkerCore mirrors the direct core for random stream ${seed}`, async ({
    page,
  }) => {
    await page.goto("/worker-core.html");
    await page.waitForFunction(() => Boolean(window.workerCore));
    const [direct, worker] = await page.evaluate(
      async ({ seed, pieces }) => {
        type Core = InstanceType<typeof window.directCore>;
        let x = seed;
        const rand = () => (x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32;
        const stream = Array.from(
          { length: 200 },
          () => pieces[Math.floor(rand() * pieces.length)],
        );
        const effects = () => ({
          responses: [] as string[],
          titles: [] as string[],
          bells: 0,
        });
        const drain = (core: Core, e: ReturnType<typeof effects>) => {
          for (let r = core.getResponse(); r !== null; r = core.getResponse())
            e.responses.push(r);
          const title = core.getTitle();
          if (title !== null) e.titles.push(title);
          e.bells += core.getBellCount();
        };
        const snapshot = (core: Core, e: ReturnType<typeof effects>) => {
          const grid = [];
          for (let r = 0; r < core.getRows(); r++)
            for (let c = 0; c < core.getCols(); c++)
              grid.push(core.getCell(r, c));
          const history = [];
          for (let o = 0; o < core.getScrollbackCount(); o++) {
            const line = [];
            for (let c = 0; c < core.getScrollbackLineLen(o); c++)
              line.push(core.getScrollbackCell(o, c));
            history.push(line);
          }
          return JSON.stringify({
            cols: core.getCols(),
            rows: core.getRows(),
            cursor: core.getCursor(),
            modes: [
              core.cursorKeysApp(),
              core.bracketedPaste(),
              core.usingAltScreen(),
              core.mouseTracking(),
              core.mouseSgr(),
              core.mouseEncoding(),
            ],
            grid,
            history,
            discarded: core.getScrollbackDiscardedCount(),
            ...e,
          });
        };

        const direct = await window.directCore.load();
        const worker = await window.workerCore.load();
        const d = effects();
        const w = effects();
        let settled = () => {};
        worker.setUpdateListener(() => {
          drain(worker as unknown as Core, w);
          settled();
        });
        direct.init(40, 10);
        worker.init(40, 10);
        stream.forEach((piece, i) => {
          direct.writeString(piece, () => drain(direct, d));
          drain(direct, d);
          worker.writeString(piece);
          if (i === 100) {
            direct.resize(30, 12);
            worker.resize(30, 12);
          }
          if (i === 150) {
            direct.setScrollbackLines(7);
            worker.setScrollbackLines(7);
          }
        });
        // Updates are batched; wait until the worker goes quiet.
        await new Promise<void>((resolve) => {
          let timer = setTimeout(resolve, 1000);
          settled = () => {
            clearTimeout(timer);
            timer = setTimeout(resolve, 200);
          };
        });
        const result = [
          snapshot(direct, d),
          snapshot(worker as unknown as Core, w),
        ];
        worker.dispose();
        return result;
      },
      { seed, pieces: PIECES },
    );
    expect(worker).toBe(direct);
  });
}

test("WorkerCore load rejects when its worker fails to start", async ({
  page,
}) => {
  await page.goto("/worker-core.html");
  await page.waitForFunction(() => Boolean(window.workerCore));
  const message = await page.evaluate(async () => {
    const url = URL.createObjectURL(
      new Blob(["throw new Error('no core')"], { type: "text/javascript" }),
    );
    try {
      await window.workerCore.load({ worker: new Worker(url) });
      return "resolved";
    } catch (error) {
      return String(error);
    }
  });
  expect(message).not.toBe("resolved");
});
