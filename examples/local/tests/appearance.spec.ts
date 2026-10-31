import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { acceptTerminal } from "./terminal-route";
import { APPEARANCE_KEY } from "../lib/appearance";

async function open(page: Page, path: string) {
  const sockets: WebSocketRoute[] = [];
  const input: string[] = [];
  const sizes: { cols: number; rows: number }[][] = [];
  await page.routeWebSocket("**/api/terminal", (socket) => {
    acceptTerminal(socket);
    const index = sockets.length;
    sockets.push(socket);
    sizes.push([]);
    socket.onMessage((data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "resize") sizes[index].push(message);
      if (message.type === "input") input.push(message.data);
    });
  });
  await page.goto(path);
  await expect(
    page.getByRole("textbox", { name: "Terminal 1", exact: true }),
  ).toBeFocused();
  await expect.poll(() => sizes[0]?.length ?? 0).toBeGreaterThan(0);
  return { sockets, input, sizes };
}
const appearanceDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Appearance", exact: true });
async function settings(page: Page) {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  return appearanceDialog(page);
}

for (const path of ["/", "/ghostty"]) {
  test(`${path}: appearance updates existing and new panes, resizes the PTY, and survives reload`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const h = await open(page, path);
    h.sockets[0].send(Buffer.from("kept output\r\n\x1b[31mred text\x1b[0m"));
    await expect(page.locator(".term-grid")).toContainText("kept output");
    await page
      .locator(".term-grid")
      .evaluate((element) => Object.assign(window, { originalGrid: element }));
    const original = h.sizes[0].at(-1)!;
    const dialog = await settings(page);
    await expect(dialog.getByRole("combobox", { name: "Theme" })).toBeFocused();
    await dialog.getByRole("combobox", { name: "Theme" }).selectOption("light");
    await dialog.getByRole("slider", { name: /Font size/ }).fill("20");
    await expect(page.locator(".local-terminal")).toHaveCSS(
      "background-color",
      "rgb(250, 250, 250)",
    );
    await expect(page.locator(".local-terminal")).toHaveCSS(
      "font-size",
      "20px",
    );
    await expect
      .poll(() => h.sizes[0].at(-1)!.cols)
      .toBeLessThan(original.cols);
    await expect
      .poll(() => h.sizes[0].at(-1)!.rows)
      .toBeLessThan(original.rows);
    await expect(page.locator(".term-grid")).toContainText("kept output");
    expect(
      await page
        .locator(".term-grid")
        .evaluate(
          (element) =>
            (window as unknown as { originalGrid: Element }).originalGrid ===
            element,
        ),
    ).toBe(true);
    expect(h.sockets).toHaveLength(1);
    expect(h.input).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Appearance", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Split right", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Terminal 2", exact: true }),
    ).toBeFocused();
    for (const terminal of await page.locator(".local-terminal").all()) {
      await expect(terminal).toHaveCSS(
        "background-color",
        "rgb(250, 250, 250)",
      );
      await expect(terminal).toHaveCSS("font-size", "20px");
    }
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      APPEARANCE_KEY,
    );
    expect(stored).toEqual({ theme: "light", fontSize: 20 });
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Terminal 2", exact: true }),
    ).toBeFocused();
    await expect(page.locator(".local-terminal")).toHaveCount(2);
    for (const terminal of await page.locator(".local-terminal").all()) {
      await expect(terminal).toHaveCSS("font-size", "20px");
      await expect(terminal).toHaveCSS(
        "background-color",
        "rgb(250, 250, 250)",
      );
    }
    await settings(page);
    await appearanceDialog(page)
      .getByRole("button", { name: "Reset defaults" })
      .click();
    for (const terminal of await page.locator(".local-terminal").all()) {
      await expect(terminal).toHaveCSS("font-size", "14px");
      await expect(terminal).toHaveCSS("background-color", "rgb(0, 0, 0)");
    }
  });
}

test("system appearance follows OS changes while explicit choices stay fixed", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const h = await open(page, "/ghostty");
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(250, 250, 250)",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  const dialog = await settings(page);
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(h.sockets).toHaveLength(1);
  expect(h.input).toEqual([]);
});

test("theme updates repaint retained indexed colors and preserve fragmented input and application overrides", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const h = await open(page, "/ghostty");
  h.sockets[0].send(
    Buffer.from(
      Array.from({ length: 200 }, (_, i) => `\x1b[31mretained ${i}\r\n`).join(
        "",
      ),
    ),
  );
  await expect(
    page.locator(".term-row").filter({ hasText: "retained 199" }),
  ).toHaveCount(1);
  await page.locator(".local-terminal").evaluate((element) => {
    element.scrollTop = 0;
  });
  const first = page.locator(".term-scrollback-row").first();
  await expect(first).toBeVisible();
  await expect(first).toContainText("retained");
  await settings(page);
  await appearanceDialog(page)
    .getByRole("combobox", { name: "Theme" })
    .selectOption("light");
  await expect(first.locator("span").first()).toHaveCSS(
    "color",
    "rgb(228, 86, 73)",
  );
  h.sockets[0].send(
    Buffer.from("\x1b]11;#123456\x07\x1b]10;#abcdef\x07\x1b[?1049h\x1b[3"),
  );
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  await appearanceDialog(page)
    .getByRole("combobox", { name: "Theme" })
    .selectOption("dark");
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  h.sockets[0].send(
    Buffer.from("2mfragment survived\x1b]110\x07\x1b]111\x07\x1b]11;?\x07"),
  );
  await expect(
    page.locator(".term-row").filter({ hasText: "fragment survived" }),
  ).toHaveCount(1);
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  await expect
    .poll(() => h.input.join(""))
    .toBe("\x1b]11;rgb:0000/0000/0000\x07");
  expect(h.sockets).toHaveLength(1);
});

test("corrupt and unavailable browser storage leave appearance usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (key) => localStorage.setItem(key, '{"theme":"invalid","fontSize":99999}'),
    APPEARANCE_KEY,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "/ghostty");
  await expect(page.locator(".local-terminal")).toHaveCSS("font-size", "14px");
  await page.evaluate(() =>
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    }),
  );
  const dialog = await settings(page);
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await expect(dialog.getByRole("status")).toContainText("could not save");
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(250, 250, 250)",
  );
  expect(errors).toEqual([]);
});

test("appearance changes and reset propagate between browser tabs", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "/ghostty");
  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: "dark" });
  await open(other, "/");
  const dialog = await settings(page);
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await expect(other.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(250, 250, 250)",
  );
  await dialog.getByRole("slider", { name: /Font size/ }).fill("18");
  await expect(other.locator(".local-terminal")).toHaveCSS("font-size", "18px");
  await page.evaluate((key) => localStorage.removeItem(key), APPEARANCE_KEY);
  await expect(other.locator(".local-terminal")).toHaveCSS("font-size", "14px");
  await expect(other.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  await other.close();
});
