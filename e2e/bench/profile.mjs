// CPU profile of one renderer on one scenario; prints top self-time functions.
// Env: TYPE=wterm SCENARIO=single SECONDS=4 OUT=profile.cpuprofile
import { chromium } from "@playwright/test";
import { startPreview } from "./server.mjs";
import { writeFile } from "node:fs/promises";

const scen = {
  single: [1, 160, 50, "halfblock"],
  wall: [16, 80, 24, "halfblock"],
  agents: [64, 80, 24, "logs"],
  kitty: [1, 160, 45, "kitty"],
  megawall: [64, 80, 24, "halfblock"],
};
const type = process.env.TYPE ?? "wterm";
const [count, cols, rows, workload] = scen[process.env.SCENARIO ?? "single"];
const server = await startPreview();
const base = server.base;
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto(base);
  await page.waitForFunction(() => "bench" in window);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  const done = page.evaluate(
    ([t, a]) => window.bench(t, ...a),
    [type, [count, cols, rows, workload, Number(process.env.SECONDS ?? 4), 1]],
  );
  await new Promise((r) => setTimeout(r, 1500));
  await cdp.send("Profiler.start");
  const res = await done;
  const { profile } = await cdp.send("Profiler.stop");
  if (process.env.OUT)
    await writeFile(process.env.OUT, JSON.stringify(profile));
  const self = new Map();
  const dt =
    (profile.endTime - profile.startTime) / profile.samples.length / 1000;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const id of profile.samples) {
    const n = byId.get(id);
    const f = n.callFrame;
    const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const idle = [...self]
    .filter(([k]) => k.startsWith("(idle)"))
    .reduce((a, [, v]) => a + v, 0);
  const busyPerFrame = ((total - idle) / total) * (1000 / res.meanFps);
  console.log(
    `${type} ${process.env.SCENARIO ?? "single"}: ${res.meanFps.toFixed(1)} fps; main thread ${busyPerFrame.toFixed(2)} ms/frame; sampled ${total.toFixed(0)} ms`,
  );

  for (const [k, v] of [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(process.env.TOP ?? 25)))
    console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
} finally {
  await browser.close();
  server.stop();
}
