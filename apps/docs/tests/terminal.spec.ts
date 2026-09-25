import { expect, test, type Page } from "@playwright/test";

const hero = ".hero-terminal";
const live = ".hero-terminal-live .wterm";
const preview = ".hero-terminal-preview";
const greeting = [
  "wterm — terminal emulator for the web",
  "",
  "Try: ls, cat README.md, echo hello",
  "",
  "user@wterm:~$",
];

async function selectTheme(page: Page, theme: string) {
  await page.locator(`footer label[for^="theme-switch-${theme}-"]`).click();
}

async function geometry(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const root = element.getBoundingClientRect();
    const cursor = element
      .querySelector(".term-cursor")!
      .getBoundingClientRect();
    const row = element.querySelector(".term-row")!.getBoundingClientRect();
    // Compare terminal-local geometry, independent of heading font swaps or
    // layout changes elsewhere on the page while hydration is held back.
    return {
      fontFamily: getComputedStyle(element).fontFamily,
      fontSize: getComputedStyle(element).fontSize,
      cursorFontFamily: getComputedStyle(element.querySelector(".term-cursor")!)
        .fontFamily,
      cursorFontSize: getComputedStyle(element.querySelector(".term-cursor")!)
        .fontSize,
      fontsStatus: document.fonts.status,
      values: [
        root.width,
        root.height,
        cursor.x - root.x,
        cursor.y - root.y,
        cursor.width,
        cursor.height,
        row.y - root.y,
        row.height,
      ],
    };
  });
}

async function expectFullscreenBackground(page: Page, dark: boolean) {
  const expected = dark ? [0, 0, 0, 255] : [255, 255, 255, 255];
  await expect
    .poll(() =>
      page.locator("#wterm-fullscreen > div").evaluate((el) => {
        // CSS optimization can serialize the same color as rgb, lab, or oklch.
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(el).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      }),
    )
    .toEqual(expected);
}

async function expectTheme(page: Page, dark: boolean) {
  await expect(page.locator("html")).toHaveClass(
    new RegExp(dark ? "dark-theme" : "light-theme"),
  );
  await expect(page.locator(live)).toHaveCSS(
    "background-color",
    dark ? "rgb(23, 23, 23)" : "rgb(250, 250, 250)",
  );
  // Ghostty resolves ANSI palette entries into RGB cells. The prompt must
  // change too, not just the CSS background surrounding old terminal output.
  await expect(
    page.locator(`${live} .term-row`).nth(4).locator("span").first(),
  ).toHaveCSS("color", dark ? "rgb(0, 202, 80)" : "rgb(6, 122, 110)");
}

test("server HTML contains the greeting and WASM preload without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(baseURL!);
    await expect(page.locator(`${preview} .term-row`)).toHaveText(greeting);
    await expect(
      page.locator("link[rel=preload][as=fetch][href='/ghostty-vt.wasm']"),
    ).toHaveAttribute("crossorigin", /^(anonymous)?$/);
    await expect(
      page.getByText("Loading terminal…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Terminal", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

for (const [saved, system, dark] of [
  ["light", "dark", false],
  ["dark", "light", true],
  ["system", "dark", true],
  ["system", "light", false],
] as const) {
  test(`matches the first frame with ${saved} theme and ${system} system`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript(
      (theme) => localStorage.setItem("geistdocs-theme", theme),
      saved,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseScripts!: () => void;
    const scripts = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    // Hold both hydration and WASM: the head script and server HTML must be
    // enough to render the selected theme before any client bundle executes.
    await page.route(/\.(?:wasm|js)(?:\?|$)/, async (route) => {
      await (/\.wasm(?:\?|$)/.test(route.request().url()) ? gate : scripts);
      await route.continue();
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto("/", { waitUntil: "commit" });
      await expect(page.locator(`${preview} .term-row`)).toHaveText(greeting);
      await expect(page.locator(preview)).toHaveCSS(
        "background-color",
        dark ? "rgb(23, 23, 23)" : "rgb(250, 250, 250)",
      );
      // Check the handoff separately from the surrounding docs layout's
      // hydration. WASM stays held while the page's scripts and fonts settle.
      releaseScripts();
      await page.waitForLoadState("domcontentloaded");
      await expect(
        page.getByRole("button", { name: "Fullscreen", exact: true }),
      ).toBeEnabled();
      await page.evaluate(async () => {
        const heading = getComputedStyle(document.querySelector("h1")!);
        // next/font's optional Arial fallback may not exist on Linux. Wait
        // for the actual webfont, without trying to load every fallback face.
        const primaryFont = heading.fontFamily.split(",")[0];
        await document.fonts.load(`${heading.fontSize} ${primaryFont}`);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      const before = await geometry(page, preview);
      const foreground = await page
        .locator(`${preview} .term-row span`)
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      release();
      await expect(page.locator(hero)).toHaveAttribute("data-state", "ready");
      await expect(page.locator(preview)).toHaveCount(0);
      expect(
        await page
          .locator(`${live} .term-row`)
          .evaluateAll((rows) =>
            rows.slice(0, 5).map((row) => row.textContent?.trimEnd()),
          ),
      ).toEqual(greeting);
      await expectTheme(page, dark);
      await expect(page.locator(`${live} .term-row span`).first()).toHaveCSS(
        "color",
        foreground,
      );
      const after = await geometry(page, live);
      for (let index = 0; index < before.values.length; index++) {
        expect(
          Math.abs(after.values[index] - before.values[index]),
          JSON.stringify({ index, before, after }),
        ).toBeLessThan(0.5);
      }
      expect(
        await page
          .locator(live)
          .evaluate((el) => el.contains(document.activeElement)),
      ).toBe(false);
      expect(errors).toEqual([]);
      // The first exposed input is ready for an actual command.
      await page.locator(live).click();
      await page.keyboard.type("echo hello-ready");
      await page.keyboard.press("Enter");
      await expect(
        page
          .locator(`${live} .term-row`)
          .filter({ hasText: /^hello-ready\s*$/ }),
      ).toHaveCount(1);
    } finally {
      releaseScripts();
      release();
    }
  });
}

test("follows site and system changes while keeping explicit presets", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator(hero)).toHaveAttribute("data-state", "ready");
  await expectTheme(page, false);
  await selectTheme(page, "dark");
  await expectTheme(page, true);
  await selectTheme(page, "light");
  await expectTheme(page, false);
  await selectTheme(page, "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, true);
  await page.getByRole("button", { name: "Solarized", exact: true }).click();
  await expect(page.locator(live)).toHaveCSS(
    "background-color",
    "rgb(0, 43, 54)",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/light-theme/);
  await expect(page.locator(live)).toHaveCSS(
    "background-color",
    "rgb(0, 43, 54)",
  );
  await page.getByRole("button", { name: "Default", exact: true }).click();
  await expectTheme(page, false);
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect(page.locator(hero)).toHaveAttribute("data-state", "ready");
  await expectTheme(page, false);
  await expect(
    page.locator(`${live} .term-row`).nth(2).locator("span").first(),
  ).toHaveCSS("opacity", "0.5");
  await expectFullscreenBackground(page, false);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, true);
  await expectFullscreenBackground(page, true);
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await expect(page.locator(hero)).toHaveAttribute("data-state", "ready");
  await expectTheme(page, true);
});

test("shows a startup failure instead of an interactive preview", async ({
  page,
}) => {
  await page.route("**/ghostty-vt.wasm", (route) =>
    route.fulfill({ status: 500, body: "unavailable" }),
  );
  await page.goto("/");
  await expect(page.locator(hero)).toHaveAttribute("data-state", "failed");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "The terminal could not load." }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Terminal", exact: true }),
  ).toHaveCount(0);
});

test("keeps a preset chosen during startup when entering fullscreen", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/ghostty-vt.wasm", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Monokai", exact: true }).click();
    await expect(page.locator(preview)).toHaveCSS(
      "background-color",
      "rgb(39, 40, 34)",
    );
    await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
    await expect(page.locator(preview)).toHaveCSS(
      "background-color",
      "rgb(39, 40, 34)",
    );
    await expect(
      page.getByRole("textbox", { name: "Terminal", exact: true }),
    ).toHaveCount(0);
    release();
    await expect(page.locator(hero)).toHaveAttribute("data-state", "ready");
    await expect(page.locator(live)).toHaveCSS(
      "background-color",
      "rgb(39, 40, 34)",
    );
    await expect(
      page.locator(`${live} .term-row`).nth(4).locator("span").first(),
    ).toHaveCSS("color", "rgb(166, 226, 46)");
    await expect(page.locator(`${live} textarea`)).toBeFocused();
  } finally {
    release();
  }
});
