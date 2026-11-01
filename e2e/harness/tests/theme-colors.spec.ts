import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const ghosttyWasm = readFileSync(
  new URL(
    "../../../packages/@wterm/ghostty/wasm/ghostty-vt.wasm",
    import.meta.url,
  ),
);

for (const coreName of ["builtin", "ghostty"] as const) {
  test(`${coreName} answers color queries with the page's theme colors`, async ({
    page,
  }) => {
    await page.route("**/theme.wasm", (route) =>
      route.fulfill({ body: ghosttyWasm, contentType: "application/wasm" }),
    );
    await page.goto("/wasm-loading.html");
    await page.waitForFunction(() => Boolean(window.terminalSizing));
    const replies = await page.evaluate(async (coreName) => {
      const style = document.createElement("style");
      style.textContent = `
        .light { --term-fg: #102030; --term-bg: #fafafa; }
        .dark { --term-fg: rgb(200 210 220); --term-bg: oklch(0.2 0 0); }
      `;
      document.head.append(style);
      const host = document.createElement("div");
      host.className = "light";
      document.body.append(host);
      const core =
        coreName === "builtin"
          ? await window.builtinLoading.load()
          : await window.ghosttyLoading.load({ wasmPath: "/theme.wasm" });
      const data: string[] = [];
      const term = new window.terminalSizing(host, {
        cols: 20,
        rows: 4,
        autoResize: false,
        core,
        onData: (d) => data.push(d),
      });
      await term.init();
      const ask = () => {
        data.length = 0;
        term.write("\x1b]10;?\x07\x1b]11;?\x1b\\");
        return [...data];
      };
      const light = ask();
      host.className = "dark";
      const dark = ask();
      term.setThemeColors({
        foreground: 0x010203,
        background: 0x040506,
        cursor: 0x070809,
        palette: Array.from({ length: 16 }, () => 0),
      });
      const explicit = ask();
      term.setThemeColors(null);
      const restored = ask();
      return { light, dark, explicit, restored };
    }, coreName);

    expect(replies.light).toEqual([
      "\x1b]10;rgb:1010/2020/3030\x07",
      "\x1b]11;rgb:fafa/fafa/fafa\x1b\\",
    ]);
    // oklch(0.2 0 0) is a dark gray; only its neutrality is fixed across engines.
    expect(replies.dark[0]).toBe("\x1b]10;rgb:c8c8/d2d2/dcdc\x07");
    expect(replies.dark[1]).toMatch(
      /^\x1b\]11;rgb:(\w\w)\1\/\1\1\/\1\1\x1b\\$/,
    );
    expect(replies.dark[1]).not.toBe(replies.light[1]);
    expect(replies.explicit).toEqual([
      "\x1b]10;rgb:0101/0202/0303\x07",
      "\x1b]11;rgb:0404/0505/0606\x1b\\",
    ]);
    expect(replies.restored).toEqual(replies.dark);
  });
}
