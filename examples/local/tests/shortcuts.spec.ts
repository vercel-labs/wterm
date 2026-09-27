import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { acceptTerminal, terminalReady } from "./terminal-route";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUTS_KEY,
  type Shortcuts,
} from "../lib/shortcuts";

const custom: Shortcuts = {
  ...DEFAULT_SHORTCUTS,
  new: ["Control+Shift+Space"],
  close: ["Control+Shift+Backspace"],
  splitRight: ["Control+Shift+Enter"],
  splitDown: ["Control+Shift+ArrowRight"],
  zoom: ["Control+Shift+Home"],
  find: ["Control+Shift+KeyG"],
};
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
const input = (page: Page, number: number) =>
  page.getByRole("textbox", { name: `Terminal ${number}`, exact: true });
async function open(page: Page, path: string) {
  const sockets: WebSocketRoute[] = [],
    inputs: string[][] = [],
    closed: number[] = [];
  await page.routeWebSocket("**/api/terminal", (socket) => {
    acceptTerminal(socket);
    const index = sockets.length;
    sockets.push(socket);
    inputs.push([]);
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "input") inputs[index].push(message.data);
      if (message.type === "close") closed.push(index);
    });
  });
  await page.goto(path);
  const ready = async (number: number) => {
    await expect(input(page, number)).toBeFocused();
    await expect.poll(() => sockets.length).toBeGreaterThanOrEqual(number);
    await terminalReady(sockets[number - 1]);
  };
  await ready(1);
  return { sockets, inputs, closed, ready };
}
async function settings(page: Page) {
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  await expect(dialog(page).getByRole("heading")).toBeFocused();
  return dialog(page);
}
async function record(page: Page, command: string, binding: string) {
  await dialog(page)
    .getByRole("button", {
      name: `Change shortcut for ${command}`,
      exact: true,
    })
    .click();
  await page.keyboard.press(binding);
}
async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keyboard shortcuts", exact: true }),
  ).toBeFocused();
}
async function seed(page: Page, shortcuts = custom) {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: SHORTCUTS_KEY, value: shortcuts },
  );
}

for (const path of ["/", "/ghostty"]) {
  test(`${path}: saved shortcuts operate sessions and panes without sending commands or repeating actions`, async ({
    page,
  }) => {
    await seed(page);
    const h = await open(page, path);
    h.sockets[0].send(Buffer.from("retained output\x1b[>3u"));
    await expect(page.locator(".term-grid")).toContainText("retained output");
    await page.keyboard.down("Control");
    await page.keyboard.down("Shift");
    await page.keyboard.down("Enter");
    await h.ready(2);
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await page.keyboard.up("Shift");
    await page.keyboard.up("Control");
    expect(h.sockets).toHaveLength(2);
    await page.keyboard.press("Control+Alt+ArrowLeft");
    await expect(input(page, 1)).toBeFocused();
    await page.keyboard.press("Control+Shift+Home");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await page.keyboard.press("Control+Shift+Home");
    await expect(page.getByRole("tabpanel")).toHaveCount(2);
    await page.keyboard.press("Control+Shift+ArrowRight");
    await h.ready(3);
    await page.keyboard.press("Control+Shift+Enter");
    await h.ready(4);
    await page.keyboard.press("Control+Shift+Enter");
    expect(h.sockets).toHaveLength(4);
    await page.keyboard.press("Control+Shift+Backspace");
    await expect(input(page, 3)).toBeFocused();
    await expect.poll(() => h.closed).toEqual([3]);
    await page.keyboard.press("Control+Shift+Space");
    await h.ready(5);
    await page.keyboard.press("Control+Shift+g");
    await expect(
      page.getByRole("textbox", { name: "Find in terminal" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input(page, 5)).toBeFocused();
    expect(h.inputs.every((values) => values.length === 0)).toBe(true);
    await input(page, 1).focus();
    await page.keyboard.type("still usable");
    await expect.poll(() => h.inputs[0].join("")).toContain("still usable");
    expect(h.sockets).toHaveLength(5);
    await expect(
      page.getByRole("tabpanel", { name: "Terminal 1", exact: true }),
    ).toContainText("retained output");
  });
}

test("recording, conflict checks, clearing, reset, and reload keep shortcuts discoverable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 576 });
  const h = await open(page, "/ghostty");
  const panel = await settings(page);
  await expect(panel.getByRole("status")).toBeInViewport();
  await expect(
    panel.getByRole("button", { name: "Close", exact: true }),
  ).toBeInViewport();
  const change = panel.getByRole("button", {
    name: "Change shortcut for Split right",
    exact: true,
  });
  await change.click();
  await change.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyG",
        key: "g",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });
  await expect(change).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await record(page, "Split right", "Control+Shift+g");
  await expect(panel.getByRole("status")).toContainText(
    "Split right: Ctrl+Shift+G",
  );
  await record(page, "Find in terminal", "Control+Shift+g");
  await expect(panel.getByRole("status")).toContainText(
    "Already assigned to Split right",
  );
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("status")).toContainText("canceled");
  await record(page, "Find in terminal", "a");
  await expect(panel.getByRole("status")).toContainText(
    "Include Control or Command",
  );
  await page.keyboard.press("Escape");
  await record(page, "Find in terminal", "Control+Shift+c");
  await expect(panel.getByRole("status")).toContainText("reserved");
  await page.keyboard.press("Escape");
  await panel
    .getByRole("button", {
      name: "Clear shortcut for Split right",
      exact: true,
    })
    .click();
  await record(page, "Find in terminal", "Control+Shift+g");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Keyboard shortcuts", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Find", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", "Control+Shift+G");
  expect(h.inputs).toEqual([[]]);
  await page.reload();
  await expect(input(page, 1)).toBeFocused();
  await page.keyboard.press("Control+Shift+g");
  await expect(
    page.getByRole("textbox", { name: "Find in terminal" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await settings(page);
  await panel
    .getByRole("button", { name: "Reset defaults", exact: true })
    .click();
  await closeSettings(page);
  await input(page, 1).focus();
  await page.keyboard.press("Control+Shift+f");
  await expect(
    page.getByRole("textbox", { name: "Find in terminal" }),
  ).toBeFocused();
});

test("shortcuts respect Find, dialogs, composition, AltGr, and already held application keys", async ({
  page,
}) => {
  await seed(page);
  const h = await open(page, "/ghostty");
  await page.keyboard.press("Control+Shift+g");
  const find = page.getByRole("textbox", { name: "Find in terminal" });
  await expect(find).toBeFocused();
  await page.keyboard.press("Control+Shift+Enter");
  await expect(find).toBeFocused();
  await page.keyboard.press("Escape");
  await settings(page);
  await page.keyboard.press("Control+Shift+Enter");
  expect(h.sockets).toHaveLength(1);
  await closeSettings(page);
  await input(page, 1).focus();
  await input(page, 1).evaluate((element) => {
    const options = {
      key: "Enter",
      code: "Enter",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    };
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    element.dispatchEvent(new KeyboardEvent("keydown", options));
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    for (const extra of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
      { key: "Dead" },
    ])
      element.dispatchEvent(
        new KeyboardEvent("keydown", { ...options, ...extra }),
      );
    const altgr = new KeyboardEvent("keydown", options);
    Object.defineProperty(altgr, "getModifierState", {
      value: (key: string) => key === "AltGraph",
    });
    element.dispatchEvent(altgr);
  });
  expect(h.sockets).toHaveLength(1);
  await expect(input(page, 1)).toBeFocused();
  await page.keyboard.press("Control+Shift+Enter");
  await h.ready(2);
});

test("closing shortcut settings does not reclaim focus after a terminal is selected", async ({
  page,
}) => {
  await open(page, "/ghostty");
  await settings(page);
  await dialog(page)
    .getByRole("button", { name: "Close", exact: true })
    .evaluate(
      (button, terminal) =>
        new Promise<void>((resolve) => {
          button
            .closest("dialog")!
            .addEventListener(
              "close",
              () => requestAnimationFrame(() => resolve()),
              { once: true },
            );
          (button as HTMLButtonElement).click();
          terminal!.focus();
        }),
      await input(page, 1).elementHandle(),
    );
  await expect(input(page, 1)).toBeFocused();
});

test("preferences synchronize across tabs and remain usable when storage is blocked", async ({
  page,
  context,
}) => {
  await open(page, "/ghostty");
  const other = await context.newPage();
  await open(other, "/");
  await settings(page);
  await record(page, "Find in terminal", "Control+Shift+g");
  await expect(
    other.getByRole("button", { name: "Find", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", "Control+Shift+G");
  await page.evaluate((key) => localStorage.removeItem(key), SHORTCUTS_KEY);
  await expect(
    other.getByRole("button", { name: "Find", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", "Meta+F Control+Shift+F");
  await page.evaluate(() =>
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    }),
  );
  await record(page, "Find in terminal", "Control+Shift+h");
  await expect(dialog(page).getByRole("status")).toContainText(
    "could not save",
  );
  await closeSettings(page);
  await input(page, 1).focus();
  await page.keyboard.press("Control+Shift+h");
  await expect(
    page.getByRole("textbox", { name: "Find in terminal" }),
  ).toBeFocused();
  await other.close();
});

test("closing the last session leaves keyboard access to a new shell", async ({
  page,
}) => {
  await seed(page);
  const h = await open(page, "/ghostty");
  await page.keyboard.press("Control+Shift+Backspace");
  await expect.poll(() => h.closed).toEqual([0]);
  await expect(
    page
      .getByRole("button", { name: "New terminal session", exact: true })
      .first(),
  ).toBeFocused();
  await page.keyboard.press("Control+Shift+Space");
  await h.ready(2);
  expect(h.inputs).toEqual([[], []]);
});

test("a pending Find request cannot take focus from a pane selected while Ghostty loads", async ({
  page,
}) => {
  await seed(page);
  const h = await open(page, "/ghostty");
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
  try {
    await page.keyboard.press("Control+Shift+Enter");
    await expect.poll(() => downloading).toBe(true);
    await page
      .getByRole("button", { name: "New terminal session", exact: true })
      .focus();
    await page.keyboard.press("Control+Shift+g");
    await page
      .getByRole("button", { name: "Focus Terminal 1", exact: true })
      .click();
    await expect(input(page, 1)).toBeFocused();
    release();
    await expect.poll(() => h.sockets.length).toBe(2);
    await expect(
      page.getByRole("textbox", { name: "Find in terminal", exact: true }),
    ).toBeVisible();
    await expect(input(page, 1)).toBeFocused();
  } finally {
    release();
  }
});
