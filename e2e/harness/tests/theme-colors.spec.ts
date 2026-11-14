import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const ghosttyWasm = readFileSync(
  new URL(
    "../../../packages/@wterm/ghostty/wasm/ghostty-vt.wasm",
    import.meta.url,
  ),
);

for (const coreName of ["builtin", "ghostty", "worker"] as const) {
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
          : coreName === "worker"
            ? await window.workerLoading.load()
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
      // WorkerCore answers after the worker's next update, not inside write().
      const ask = async (
        parts: (string | Uint8Array)[] = ["\x1b]10;?\x07\x1b]11;?\x1b\\"],
        replies = 2,
      ) => {
        data.length = 0;
        for (const part of parts) term.write(part);
        const deadline = performance.now() + 2000;
        while (data.length < replies && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 10));
        return [...data];
      };
      const light = await ask();
      host.className = "dark";
      const dark = await ask();
      term.setThemeColors({
        foreground: 0x010203,
        background: 0x040506,
        cursor: 0x070809,
        palette: Array.from({ length: 16 }, () => 0),
      });
      const explicit = await ask();
      term.setThemeColors(null);
      const restored = await ask();
      // PTY and WebSocket chunks can cut the query anywhere.
      host.className = "light";
      const lightSplit = await ask(
        [new TextEncoder().encode("\x1b]1"), "1;?\x07"],
        1,
      );
      return { light, dark, explicit, restored, lightSplit };
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
    expect(replies.lightSplit).toEqual(["\x1b]11;rgb:fafa/fafa/fafa\x07"]);
  });
}

for (const coreName of ["builtin", "ghostty"] as const) {
  test(`${coreName} answers dark/light queries with the page's current CSS theme`, async ({
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
        .dark { --term-fg: #c8d2dc; --term-bg: #101010; }
      `;
      document.head.append(style);
      const host = document.createElement("div");
      host.className = "dark";
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
      const ask = (bytes = false, parts = ["\x1b[?996n"]) => {
        data.length = 0;
        for (const part of parts)
          term.write(bytes ? new TextEncoder().encode(part) : part);
        return [...data];
      };
      const dark = ask();
      host.className = "light";
      // PTY hosts write bytes; both input forms must refresh the CSS theme.
      const light = ask(true);
      host.className = "dark";
      const darkAgain = ask();
      // PTY and WebSocket chunks can cut the query anywhere.
      host.className = "light";
      const lightSplit = ask(false, ["\x1b[?99", "6n"]);
      host.className = "dark";
      const darkSplit = ask(true, ["\x1b", "[?9", "", "96n"]);
      // With mode 2031 on, the query reply is the only report of the change.
      ask(false, ["\x1b[?2031h"]);
      host.className = "light";
      const lightReporting = ask();
      host.className = "dark";
      const darkBackground = ask(false, ["\x1b]11;?\x07"]);
      // An OSC 10 reply leaves the scheme out, so the change is still reported.
      host.className = "light";
      const lightForeground = ask(false, ["\x1b]10;?\x07"]);
      const lightAfterForeground = ask();
      // A query for both colors carries the background, so no report goes out.
      host.className = "dark";
      ask();
      host.className = "light";
      const lightPair = ask(false, ["\x1b]10;?;?\x07"]);
      // Setting a color asks for nothing, so the next query reports the change.
      host.className = "dark";
      ask();
      host.className = "light";
      const lightColorSet = ask(false, ["\x1b]10;#102030\x07"]);
      const lightAfterColorSet = ask();
      // An empty parameter makes the color this `?` asks for core-specific, so
      // the scheme is still reported ahead of the reply.
      host.className = "dark";
      ask();
      host.className = "light";
      const lightAmbiguous = ask(false, ["\x1b]10;;?\x07"]);
      // A background the application sets answers later queries in place of
      // the theme's, so the scheme is still reported ahead of that reply.
      const backgroundSet = ask(false, ["\x1b]11;#123456\x07"]);
      host.className = "dark";
      const overridden = ask(false, ["\x1b]11;?\x07"]);
      // Setting it in the same write as the query keeps the report too.
      host.className = "light";
      const overriddenSameWrite = ask(false, [
        "\x1b]11;#654321\x07\x1b]11;?\x07",
      ]);
      // The 996 reply carries the scheme whatever background is on screen.
      host.className = "dark";
      const schemeUnderOverride = ask();
      return {
        dark,
        light,
        darkAgain,
        lightSplit,
        darkSplit,
        lightReporting,
        darkBackground,
        lightForeground,
        lightAfterForeground,
        lightPair,
        lightColorSet,
        lightAfterColorSet,
        lightAmbiguous,
        backgroundSet,
        overridden,
        overriddenSameWrite,
        schemeUnderOverride,
      };
    }, coreName);

    expect(replies.dark).toEqual(["\x1b[?997;1n"]);
    expect(replies.light).toEqual(["\x1b[?997;2n"]);
    expect(replies.darkAgain).toEqual(["\x1b[?997;1n"]);
    expect(replies.lightSplit).toEqual(["\x1b[?997;2n"]);
    expect(replies.darkSplit).toEqual(["\x1b[?997;1n"]);
    expect(replies.lightReporting).toEqual(["\x1b[?997;2n"]);
    expect(replies.darkBackground).toEqual(["\x1b]11;rgb:1010/1010/1010\x07"]);
    expect(replies.lightForeground).toEqual([
      "\x1b[?997;2n",
      "\x1b]10;rgb:1010/2020/3030\x07",
    ]);
    expect(replies.lightAfterForeground).toEqual(["\x1b[?997;2n"]);
    expect(replies.lightPair).toEqual([
      "\x1b]10;rgb:1010/2020/3030\x07",
      "\x1b]11;rgb:fafa/fafa/fafa\x07",
    ]);
    expect(replies.lightColorSet).toEqual([]);
    expect(replies.lightAfterColorSet).toEqual(["\x1b[?997;2n"]);
    // A core-specific query reports the scheme first; only the reply's color
    // differs, the built-in core answering with the background.
    expect(replies.lightAmbiguous).toHaveLength(2);
    expect(replies.lightAmbiguous[0]).toBe("\x1b[?997;2n");
    expect(replies.backgroundSet).toEqual([]);
    // Only a Ghostty core keeps the application's own background, so only
    // there does the reply need the scheme reported ahead of it.
    expect(replies.overridden).toEqual(
      coreName === "ghostty"
        ? ["\x1b[?997;1n", "\x1b]11;rgb:1212/3434/5656\x07"]
        : ["\x1b]11;rgb:1010/1010/1010\x07"],
    );
    expect(replies.overriddenSameWrite).toEqual([
      "\x1b[?997;2n",
      coreName === "ghostty"
        ? "\x1b]11;rgb:6565/4343/2121\x07"
        : "\x1b]11;rgb:fafa/fafa/fafa\x07",
    ]);
    expect(replies.schemeUnderOverride).toEqual(["\x1b[?997;1n"]);
  });
}
