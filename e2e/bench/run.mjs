// Headed benchmark of wterm renderers: rotates renderer order per round, fresh browser per run.
// Env: SCENARIOS=single,wall,agents  TYPES=wterm,wterm-webgl,wterm-ghostty,wterm-ghostty-webgl  ROUNDS=3  SECONDS=8  OUT=results.json
import { chromium } from "@playwright/test";
import { startPreview } from "./server.mjs";
import { writeFile } from "node:fs/promises";

const all = {
  single: { count: 1, cols: 160, rows: 50, workload: "halfblock" },
  wall: { count: 16, cols: 80, rows: 24, workload: "halfblock" },
  agents: { count: 64, cols: 80, rows: 24, workload: "logs" },
  kitty: { count: 1, cols: 160, rows: 45, workload: "kitty" },
  // Stress: past the display cap for every renderer on current hardware.
  bigwall: { count: 16, cols: 160, rows: 50, workload: "halfblock" },
  megawall: { count: 64, cols: 80, rows: 24, workload: "halfblock" },
};
const scenarios = (process.env.SCENARIOS ?? "single,wall,agents").split(",");
const types = (
  process.env.TYPES ?? "wterm,wterm-webgl,wterm-ghostty,wterm-ghostty-webgl"
).split(",");
const rounds = Number(process.env.ROUNDS ?? 3);
const seconds = Number(process.env.SECONDS ?? 8);
const server = await startPreview();
const base = server.base;

const runs = [];
try {
  for (let round = 0; round < rounds; round++)
    for (const name of scenarios) {
      const s = all[name];
      for (let k = 0; k < types.length; k++) {
        const type = types[(k + round) % types.length];
        const browser = await chromium.launch({
          executablePath:
            process.env.CHROME_PATH ??
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          headless: process.env.HEADLESS === "1",
          args: ["--window-position=0,0"],
        });
        const page = await browser.newPage({
          viewport: { width: 1600, height: 900 },
          deviceScaleFactor: 2,
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(base);
        await page.waitForFunction(() => "bench" in window);
        const r = await page
          .evaluate(
            ([t, a]) => window.bench(t, ...a),
            [type, [s.count, s.cols, s.rows, s.workload, seconds]],
          )
          .catch((e) => ({ failed: String(e.message ?? e).slice(0, 200) }));
        if (process.env.SHOTS)
          await page.screenshot({
            path: `${process.env.SHOTS}/${name}-${type}-${round}.png`,
          });
        await browser.close();
        const row = { round, scenario: name, ...r, type, errors };
        runs.push(row);
        console.log(
          `${round} ${name.padEnd(7)} ${type.padEnd(14)} ${r.failed ? "FAILED " + r.failed : `${r.meanFps.toFixed(1)} fps (min ${r.minFps.toFixed(1)}) mount ${r.mountMs.toFixed(0)}ms longtasks ${r.longTasks} gpu ${r.gpuVisible}`}`,
        );
      }
    }
} finally {
  server.stop();
}
await writeFile(
  process.env.OUT ?? "results.json",
  JSON.stringify({ measured: new Date().toISOString(), runs }, null, 2),
);
