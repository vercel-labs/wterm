import { chromium } from "@playwright/test";
import { startPreview } from "./server.mjs";
const server = await startPreview();
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
});
try {
  const page = await browser.newPage({
    viewport: { width: 700, height: 240 },
    deviceScaleFactor: 2,
  });
  await page.goto(server.base);
  await page.waitForFunction(() => "visual" in window);
  for (const mode of ["dom", "webgl"]) {
    await page.evaluate((m) => window.visual(m), mode);
    await page.screenshot({
      path: `${process.env.OUT_DIR ?? "/tmp"}/visual-${mode}.png`,
    });
  }
} finally {
  await browser.close();
  server.stop();
}
