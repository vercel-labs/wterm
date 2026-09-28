import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const body = readFileSync(
  new URL(
    "../../../packages/@wterm/ghostty/wasm/ghostty-vt.wasm",
    import.meta.url,
  ),
);

for (const coreName of ["builtin", "ghostty"] as const) {
  test(`${coreName} initializes at the visible content size without reflowing a default grid`, async ({
    page,
  }) => {
    await page.route("**/sizing.wasm", (route) =>
      route.fulfill({ body, contentType: "application/wasm" }),
    );
    await page.goto("/wasm-loading.html");
    await page.waitForFunction(() => Boolean(window.terminalSizing));
    const result = await page.evaluate(async (coreName) => {
      const host = document.createElement("div");
      host.style.cssText =
        "width:1100px;height:700px;box-sizing:border-box;padding:10px;border:2px solid;font-size:14px";
      document.body.append(host);
      const core =
        coreName === "builtin"
          ? await window.builtinLoading.load()
          : await window.ghosttyLoading.load({
              wasmPath: "/sizing.wasm",
              scrollbackLimit: 8 * 1024 * 1024,
            });
      const inits: number[][] = [];
      const resizes: number[][] = [];
      const init = core.init.bind(core);
      const resize = core.resize.bind(core);
      core.init = (cols, rows) => {
        inits.push([cols, rows]);
        init(cols, rows);
      };
      core.resize = (cols, rows) => {
        resizes.push([cols, rows]);
        resize(cols, rows);
      };
      const events: number[][] = [];
      const term = new window.terminalSizing(host, {
        core,
        onResize: (cols, rows) => events.push([cols, rows]),
      });
      try {
        await document.fonts.ready;
        await term.init();
        const initial = [term.cols, term.rows];
        term.fit();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const rowHeight = host
          .querySelector(".term-row")!
          .getBoundingClientRect().height;
        const cellWidth = parseFloat(
          getComputedStyle(host).getPropertyValue("--term-cell-width"),
        );
        const firstResizes = resizes.slice();
        host.style.width = "900px";
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        term.write("hello 界\r\nnext");
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {
          inits,
          initial,
          firstResizes,
          events,
          cellWidth,
          rowHeight,
          final: [term.cols, term.rows],
          text: host.textContent,
        };
      } finally {
        term.destroy();
        if (core instanceof window.ghosttyLoading) core.dispose();
        host.remove();
      }
    }, coreName);
    expect(result.inits).toEqual([
      [Math.floor(1076 / result.cellWidth), Math.floor(676 / result.rowHeight)],
    ]);
    expect(result.initial).toEqual(result.inits[0]);
    expect(result.firstResizes).toEqual([]);
    expect(result.events[0]).toEqual(result.initial);
    expect(result.final).toEqual([
      Math.floor(876 / result.cellWidth),
      result.initial[1],
    ]);
    expect(result.text).toContain("hello 界");
    expect(result.text).toContain("next");
  });
}
