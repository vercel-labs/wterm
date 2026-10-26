/**
 * Measures frames per terminal per second with the frame cap off, and checks
 * four still screens against a saved baseline.
 */
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const baselineDir = flag(
  "--baseline-dir",
  join(here, "../test-results/throughput-baseline"),
);
const saveBaseline = argv.includes("--save-baseline");
const repeat = Number(flag("--repeat", "1"));
const seconds = Number(flag("--seconds", "4"));
const only = flag("--only", "");
const metrics = argv.includes("--metrics");

const out = await mkdtemp(join(tmpdir(), "wterm-throughput-"));
await build({
  root: here,
  logLevel: "error",
  build: {
    outDir: out,
    emptyOutDir: true,
    rollupOptions: { input: join(here, "throughput.html") },
  },
});
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
};
const server = createServer(async (req, res) => {
  try {
    const path = join(
      out,
      decodeURIComponent(new URL(req.url, "http://x").pathname),
    );
    if (!path.startsWith(out + sep)) throw new Error("outside build");
    const body = await readFile(path);
    res
      .writeHead(200, {
        "content-type": types[extname(path)] ?? "application/octet-stream",
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/throughput.html`;

const browser = await chromium.launch({
  args: [
    "--disable-gpu-vsync",
    "--disable-frame-rate-limit",
    "--enable-gpu-rasterization",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
});

async function fresh() {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent === "Ready",
  );
  return { page, errors };
}

const scenarios = [
  { key: "halfblock_1", count: 1, cols: 160, rows: 50, workload: "halfblock" },
  { key: "halfblock_16", count: 16, cols: 80, rows: 24, workload: "halfblock" },
  { key: "logs_64", count: 64, cols: 80, rows: 24, workload: "logs" },
  { key: "halfblock_64", count: 64, cols: 80, rows: 24, workload: "halfblock" },
  { key: "tui_1", count: 1, cols: 160, rows: 50, workload: "tui" },
].filter((s) => !only || only.split(",").includes(s.key));

const result = { errors: [] };
const samples = {};
const mounts = {};
for (let r = 0; r < repeat; r++) {
  for (const s of scenarios) {
    const { page, errors } = await fresh();
    const cdp = metrics ? await page.context().newCDPSession(page) : null;
    const read = async () => {
      if (!cdp) return {};
      const { metrics: m } = await cdp.send("Performance.getMetrics");
      return Object.fromEntries(m.map((x) => [x.name, x.value]));
    };
    if (cdp) await cdp.send("Performance.enable");
    const before = await read();
    const report = await page.evaluate((o) => window.throughput.run(o), {
      ...s,
      warm: 1,
      seconds,
    });
    if (cdp) {
      const after = await read();
      const frames = report.meanFps * s.count * (seconds + 1);
      const per = (k) =>
        Math.round(((after[k] - before[k]) * 1000 * 100) / frames) / 100;
      result[`${s.key}_ms_per_term_frame`] = {
        task: per("TaskDuration"),
        script: per("ScriptDuration"),
        style: per("RecalcStyleDuration"),
        layout: per("LayoutDuration"),
        js_core_write: report.coreMs,
        js_render: report.renderMs,
      };
    }
    (samples[s.key] ??= []).push(report.meanFps);
    (mounts[s.key] ??= []).push(report.mountMs);
    if (
      s.workload === "halfblock" &&
      !report.lastRows.every((row) => row === "▀".repeat(s.cols))
    )
      result.errors.push(`${s.key}: rendered text is not all half blocks`);
    if (
      s.workload === "logs" &&
      !/agent-0 · \d+ updates/.test(report.lastRows.at(-1) ?? "")
    )
      result.errors.push(`${s.key}: status line missing`);
    if (
      s.workload === "tui" &&
      !/^ cpu\d\d +\d+% /.test(report.lastRows[0] ?? "")
    )
      result.errors.push(`${s.key}: dashboard text missing`);
    result.errors.push(...errors.map((e) => `${s.key}: ${e}`));
    await page.close();
  }
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const [key, xs] of Object.entries(samples)) {
  result[`${key}_fps`] = Math.round(median(xs) * 10) / 10;
  result[`${key}_samples`] = xs.map((x) => Math.round(x * 10) / 10);
  result[`${key}_mount_ms_per_term`] = median(mounts[key]);
}
const fpsValues = Object.keys(samples).map((k) => result[`${k}_fps`]);
result.geomean_fps =
  Math.round(
    Math.exp(
      fpsValues.reduce((a, x) => a + Math.log(x), 0) / fpsValues.length,
    ) * 10,
  ) / 10;

await mkdir(baselineDir, { recursive: true });
let textOk = true;
let pixelMax = 0;
for (const kind of ["halfblock", "logs", "mixed", "tui"]) {
  const { page } = await fresh();
  const still = await page.evaluate((k) => window.throughput.still(k), kind);
  const png = await page.screenshot({ clip: still.rect });
  const pngPath = join(baselineDir, `${kind}.png`);
  const textPath = join(baselineDir, `${kind}.json`);
  if (saveBaseline) {
    await writeFile(pngPath, png);
    await writeFile(textPath, JSON.stringify(still.rows));
  } else if (existsSync(pngPath)) {
    const expected = JSON.parse(await readFile(textPath, "utf8"));
    const same = JSON.stringify(expected) === JSON.stringify(still.rows);
    textOk &&= same;
    if (!same) result.errors.push(`${kind}: text differs from baseline`);
    const base = (await readFile(pngPath)).toString("base64");
    const mismatch = await page.evaluate(
      async ([a, b]) => {
        const decode = async (s) => {
          const bmp = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${s}`)).blob(),
          );
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d");
          ctx.drawImage(bmp, 0, 0);
          return ctx.getImageData(0, 0, bmp.width, bmp.height);
        };
        const [x, y] = await Promise.all([decode(a), decode(b)]);
        if (x.width !== y.width || x.height !== y.height) return 100;
        let bad = 0;
        for (let i = 0; i < x.data.length; i += 4) {
          const d = Math.max(
            Math.abs(x.data[i] - y.data[i]),
            Math.abs(x.data[i + 1] - y.data[i + 1]),
            Math.abs(x.data[i + 2] - y.data[i + 2]),
          );
          if (d > 48) bad++;
        }
        return (100 * bad) / (x.width * x.height);
      },
      [base, png.toString("base64")],
    );
    result[`${kind}_pixel_mismatch_pct`] = Math.round(mismatch * 1000) / 1000;
    pixelMax = Math.max(pixelMax, mismatch);
    if (mismatch > 0.5) {
      result.errors.push(`${kind}: ${mismatch.toFixed(3)}% of pixels differ`);
      await writeFile(join(baselineDir, `${kind}.actual.png`), png);
    }
  }
  await page.close();
}
result.text_ok = textOk;
result.pixel_mismatch_pct_max = Math.round(pixelMax * 1000) / 1000;
result.ok = result.errors.length === 0;
await browser.close();
server.close();
await rm(out, { recursive: true, force: true });
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
