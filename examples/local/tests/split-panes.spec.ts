import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { acceptTerminal } from "./terminal-route";

async function workspace(page: Page, path: string) {
  const sockets: WebSocketRoute[] = [];
  const inputs: string[][] = [];
  const sizes: { cols: number; rows: number }[][] = [];
  const closed: number[] = [];
  await page.routeWebSocket("**/api/terminal", (socket) => {
    acceptTerminal(socket);
    const index = sockets.length;
    sockets.push(socket);
    inputs.push([]);
    sizes.push([]);
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "input") inputs[index].push(message.data);
      if (message.type === "close") closed.push(index);
      if (message.type === "resize") {
        sizes[index].push({ cols: message.cols, rows: message.rows });
        socket.send(
          JSON.stringify({ type: "cwd", cwd: `/session-${index + 1}` }),
        );
      }
    });
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(path);
  const panel = (number: number) =>
    page.getByRole("tabpanel", { name: `Terminal ${number}`, exact: true });
  const input = (number: number) =>
    page.getByRole("textbox", { name: `Terminal ${number}`, exact: true });
  const ready = async (number: number) => {
    await expect(
      page.getByRole("button", { name: `/session-${number}`, exact: true }),
    ).toBeVisible();
    await expect(input(number)).toBeFocused();
  };
  await ready(1);
  // Retain DOM identities to detect accidental remounts during layout changes.
  await panel(1).evaluate((element) =>
    Object.assign(window, {
      firstPane: element,
      firstGrid: element.querySelector(".term-grid"),
    }),
  );
  const send = (number: number, text: string) =>
    sockets[number - 1].send(Buffer.from(text));
  return { sockets, inputs, sizes, closed, panel, input, ready, send };
}

for (const path of ["/", "/ghostty"]) {
  test(`${path}: nested splits paint concurrently and direct input only to the focused shell`, async ({
    page,
  }) => {
    const h = await workspace(page, path);
    h.send(1, "first shell");
    await expect(h.panel(1)).toContainText("first shell");
    await h
      .panel(1)
      .getByRole("button", { name: "Split right", exact: true })
      .click();
    await h.ready(2);
    await h
      .panel(2)
      .getByRole("button", { name: "Split down", exact: true })
      .click();
    await h.ready(3);
    for (let i = 1; i <= 3; i++) h.send(i, `\r\x1b[2Kvisible stream ${i}`);
    for (let i = 1; i <= 3; i++)
      await expect(h.panel(i)).toContainText(`visible stream ${i}`);
    const rects = await Promise.all(
      [1, 2, 3].map((i) => h.panel(i).boundingBox()),
    );
    expect(rects[0]!.x + rects[0]!.width).toBeLessThan(rects[1]!.x);
    expect(rects[1]!.y + rects[1]!.height).toBeLessThan(rects[2]!.y);
    await page.keyboard.type("third");
    await page.keyboard.press("Control+Alt+ArrowUp");
    await expect(h.input(2)).toBeFocused();
    await page.keyboard.type("second");
    await page.keyboard.press("Meta+Alt+ArrowLeft");
    await expect(h.input(1)).toBeFocused();
    await page.keyboard.type("first");
    await expect
      .poll(() => h.inputs.map((input) => input.join("")))
      .toEqual(["first", "second", "third"]);
    expect(h.sockets).toHaveLength(3);
    expect(h.closed).toEqual([]);
    expect(
      await h.panel(1).evaluate((element) => {
        const saved = window as unknown as {
          firstPane: Element;
          firstGrid: Element;
        };
        return (
          saved.firstPane === element &&
          saved.firstGrid === element.querySelector(".term-grid")
        );
      }),
    ).toBe(true);
  });

  test(`${path}: selecting, zooming, and closing panes retains other shell instances`, async ({
    page,
  }) => {
    const h = await workspace(page, path);
    await h
      .panel(1)
      .getByRole("button", { name: "Split right", exact: true })
      .click();
    await h.ready(2);
    await page
      .getByRole("button", { name: "New terminal session", exact: true })
      .click();
    await h.ready(3);
    await expect(h.panel(1)).toBeVisible();
    await expect(h.panel(2)).toHaveCount(0);
    h.send(2, "retained hidden output");
    await page.getByRole("button", { name: "/session-2", exact: true }).click();
    await expect(h.input(2)).toBeFocused();
    await expect(h.panel(2)).toContainText("retained hidden output");
    await expect(h.panel(1)).toBeVisible();
    await expect(h.panel(3)).toHaveCount(0);
    await h
      .panel(1)
      .getByRole("button", { name: "Zoom pane", exact: true })
      .click();
    await expect(h.input(1)).toBeFocused();
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    expect(h.closed).toEqual([]);
    await h
      .panel(1)
      .getByRole("button", { name: "Restore panes", exact: true })
      .click();
    await expect(h.panel(2)).toBeVisible();
    await expect(h.input(1)).toBeFocused();
    await page
      .getByRole("button", { name: "Close Terminal 1", exact: true })
      .click();
    await expect(h.input(2)).toBeFocused();
    await expect.poll(() => h.closed).toEqual([0]);
    await expect(h.panel(2)).toContainText("retained hidden output");
    expect(h.sockets).toHaveLength(3);
  });

  test(`${path}: pointer and keyboard dividers resize live PTYs within pane bounds`, async ({
    page,
  }) => {
    const h = await workspace(page, path);
    await h
      .panel(1)
      .getByRole("button", { name: "Split right", exact: true })
      .click();
    await h.ready(2);
    await expect
      .poll(() => h.sizes[0].at(-1)!.cols)
      .toBeLessThan(h.sizes[0][0].cols);
    const separator = page.getByRole("separator", {
      name: "Resize panes horizontally",
    });
    const before = (await h.panel(1).boundingBox())!.width;
    await separator.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await h.panel(1).boundingBox())!.width)
      .toBeGreaterThan(before);
    await expect(separator).toBeFocused();
    const expectedCols = h.sizes[0].at(-1)!.cols;
    const bar = (await separator.boundingBox())!;
    await page.mouse.move(bar.x + bar.width / 2, bar.y + 40);
    await page.mouse.down();
    await page.mouse.move(bar.x - 80, bar.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => h.sizes[0].at(-1)!.cols).toBeLessThan(expectedCols);
    await separator.focus();
    await page.keyboard.press("Home");
    await expect
      .poll(async () => Math.round((await h.panel(1).boundingBox())!.width))
      .toBe(320);
    await page.keyboard.press("Enter");
    await expect(separator).toHaveAttribute("aria-valuenow", "50");
    expect(h.inputs).toEqual([[], []]);
    await page.setViewportSize({ width: 800, height: 620 });
    await expect
      .poll(async () => (await h.panel(1).boundingBox())!.width)
      .toBeGreaterThanOrEqual(320);
    await expect
      .poll(async () => (await h.panel(2).boundingBox())!.width)
      .toBeGreaterThanOrEqual(320);
    expect(h.sockets).toHaveLength(2);
    await page.getByRole("button", { name: "/session-2", exact: true }).click();
    await expect(h.input(2)).toBeFocused();
    await expect
      .poll(async () => {
        const rect = (await h.panel(2).boundingBox())!;
        return rect.x + rect.width;
      })
      .toBeLessThanOrEqual(800);
    await h
      .panel(1)
      .getByRole("button", { name: "Split down", exact: true })
      .click();
    await h.ready(3);
    const vertical = page.getByRole("separator", {
      name: "Resize panes vertically",
    });
    await vertical.focus();
    await page.keyboard.press("Home");
    await expect
      .poll(async () => Math.round((await h.panel(1).boundingBox())!.height))
      .toBe(220);
    await page
      .getByRole("button", { name: "Close Terminal 3", exact: true })
      .click();
    await expect(vertical).toHaveCount(0);
    await expect(h.input(1)).toBeFocused();
    await expect.poll(() => h.closed).toEqual([2]);
  });

  test(`${path}: pane activation preserves dialog and Find focus and caps visible splits`, async ({
    page,
  }) => {
    const h = await workspace(page, path);
    await h
      .panel(1)
      .getByRole("button", { name: "Split right", exact: true })
      .click();
    await h.ready(2);
    // Activate the other pane by opening its reader; focus must stay in the dialog.
    await h
      .panel(1)
      .getByRole("button", { name: "Read output", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Terminal 1 output",
      exact: true,
    });
    await expect(dialog.getByRole("heading")).toBeFocused();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await h.panel(2).getByRole("button", { name: "Find", exact: true }).click();
    const find = h
      .panel(2)
      .getByRole("textbox", { name: "Find in terminal", exact: true });
    await expect(find).toBeFocused();
    await find.fill("query");
    await page.keyboard.press("Control+Alt+ArrowLeft");
    await expect(find).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(h.input(2)).toBeFocused();
    await h
      .panel(2)
      .getByRole("button", { name: "Split down", exact: true })
      .click();
    await h.ready(3);
    await h
      .panel(1)
      .getByRole("button", { name: "Split down", exact: true })
      .click();
    await h.ready(4);
    await expect(page.getByRole("tabpanel")).toHaveCount(4);
    for (const button of await page
      .getByRole("button", { name: /^Split (right|down)$/ })
      .all())
      await expect(button).toBeDisabled();
    expect(h.sockets).toHaveLength(4);
    expect(h.inputs).toEqual([[], [], [], []]);
  });
}

test("a delayed Ghostty pane cannot take focus from the pane selected while it loads", async ({
  page,
}) => {
  const h = await workspace(page, "/ghostty");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let downloading = false;
  await page.route("**/ghostty-vt.wasm", async (route) => {
    downloading = true;
    await gate;
    await route.continue();
  });
  await h
    .panel(1)
    .getByRole("button", { name: "Split right", exact: true })
    .click();
  await expect.poll(() => downloading).toBe(true);
  await h
    .panel(1)
    .getByRole("button", { name: "Focus Terminal 1", exact: true })
    .click();
  await expect(h.input(1)).toBeFocused();
  release();
  await expect(
    page.getByRole("button", { name: "/session-2", exact: true }),
  ).toBeVisible();
  await expect(h.input(2)).toBeVisible();
  await expect(h.input(1)).toBeFocused();
  await page.keyboard.type("first only");
  await expect
    .poll(() => h.inputs.map((input) => input.join("")))
    .toEqual(["first only", ""]);
  await page
    .getByRole("button", { name: "Close Terminal 2", exact: true })
    .click();
  await expect(h.input(1)).toBeFocused();
  expect(h.sockets).toHaveLength(2);
});
