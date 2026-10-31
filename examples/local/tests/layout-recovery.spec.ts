import { expect, test, type Page } from "@playwright/test";

async function server(page: Page) {
  const sessions = new Map<
    string,
    { number: number; input: number; text: string }
  >();
  const attaches: (string | null)[] = [];
  const closed: string[] = [];
  await page.routeWebSocket("**/api/terminal", (socket) => {
    let token: string;
    let fresh = false;
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "attach") {
        attaches.push(message.session);
        token = message.session ?? (sessions.size + 1).toString(16).repeat(64);
        fresh = message.session === null;
        if (fresh)
          sessions.set(token, {
            number: sessions.size + 1,
            input: 0,
            text: "",
          });
        const session = sessions.get(token)!;
        socket.send(
          JSON.stringify({
            type: "ready",
            session: token,
            resumed: !fresh,
            input: session.input,
          }),
        );
        socket.send(
          JSON.stringify({ type: "cwd", cwd: `/shell-${session.number}` }),
        );
      } else if (message.type === "resize" && fresh) {
        fresh = false;
        socket.send(
          Buffer.from(`shell ${sessions.get(token)!.number} output\r\n`),
        );
      } else if (message.type === "input") {
        const session = sessions.get(token)!;
        session.input = message.id;
        session.text += message.data;
        socket.send(JSON.stringify({ type: "input-ack", input: message.id }));
      } else if (message.type === "close") closed.push(token);
    });
  });
  return { sessions, attaches, closed };
}
const panel = (page: Page, number: number) =>
  page.getByRole("tabpanel", { name: `Terminal ${number}`, exact: true });
const input = (page: Page, number: number) =>
  page.getByRole("textbox", { name: `Terminal ${number}`, exact: true });
async function ready(page: Page, number: number) {
  await expect(panel(page, number)).toContainText(`shell ${number} output`);
  await expect(input(page, number)).toBeFocused();
}
async function split(page: Page, number: number, direction: "right" | "down") {
  await panel(page, number)
    .getByRole("button", { name: `Split ${direction}`, exact: true })
    .click();
}
async function geometry(page: Page) {
  return page.getByRole("tabpanel").evaluateAll((panes) =>
    panes.map((pane) => {
      // Use layout coordinates so scrolling the canvas to focus a pane is irrelevant.
      const element = pane as HTMLElement;
      return {
        name: element.getAttribute("aria-label"),
        x: element.offsetLeft,
        y: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
    }),
  );
}

for (const route of ["/", "/ghostty"]) {
  test(`${route}: reload retains nested divider positions, active input and hidden sessions`, async ({
    page,
  }) => {
    const h = await server(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(route);
    await ready(page, 1);
    await split(page, 1, "right");
    await ready(page, 2);
    await split(page, 2, "down");
    await ready(page, 3);
    await page
      .getByRole("button", { name: "New terminal session", exact: true })
      .click();
    await ready(page, 4);
    for (const [name, key] of [
      ["Resize panes horizontally", "ArrowRight"],
      ["Resize panes vertically", "ArrowDown"],
    ]) {
      await page.getByRole("separator", { name }).focus();
      await page.keyboard.press(key);
      await page.keyboard.press(key);
    }
    await page.getByRole("button", { name: "/shell-2", exact: true }).click();
    await expect(input(page, 2)).toBeFocused();
    const before = await geometry(page);
    await page.reload();
    await expect.poll(() => h.attaches.length).toBe(8);
    expect(h.attaches.slice(4).sort()).toEqual([...h.sessions.keys()].sort());
    await expect.poll(() => geometry(page)).toEqual(before);
    await expect(input(page, 2)).toBeFocused();
    for (const number of [1, 2, 4])
      await expect(panel(page, number)).toContainText(`shell ${number} output`);
    await expect(panel(page, 3)).toHaveCount(0);
    await page.keyboard.type("focused-only");
    await expect
      .poll(() => [...h.sessions.values()].map((session) => session.text))
      .toEqual(["", "focused-only", "", ""]);
    await page.getByRole("button", { name: "/shell-3", exact: true }).click();
    await expect(input(page, 3)).toBeFocused();
    await expect(panel(page, 3)).toContainText("shell 3 output");
    expect(h.attaches).toHaveLength(8);
    expect(h.closed).toEqual([]);
  });

  test(`${route}: zoom survives reload and restores its arrangement in a smaller window`, async ({
    page,
  }) => {
    const h = await server(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(route);
    await ready(page, 1);
    await split(page, 1, "right");
    await ready(page, 2);
    await split(page, 2, "down");
    await ready(page, 3);
    await panel(page, 2)
      .getByRole("button", { name: "Zoom pane", exact: true })
      .click();
    await expect(input(page, 2)).toBeFocused();
    await page.setViewportSize({ width: 720, height: 640 });
    await page.reload();
    await expect.poll(() => h.attaches.length).toBe(6);
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(input(page, 2)).toBeFocused();
    await panel(page, 2)
      .getByRole("button", { name: "Restore panes", exact: true })
      .click();
    await expect(page.getByRole("tabpanel")).toHaveCount(3);
    await expect(input(page, 2)).toBeFocused();
    const boxes = await geometry(page);
    expect(boxes[0].x + boxes[0].width).toBeLessThan(boxes[1].x);
    expect(boxes[1].y + boxes[1].height).toBeLessThan(boxes[2].y);
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(320);
      expect(box.height).toBeGreaterThanOrEqual(220);
    }
    await page.reload();
    await expect.poll(() => geometry(page)).toEqual(boxes);
    await expect(input(page, 2)).toBeFocused();
    expect(h.attaches.filter((token) => token === null)).toHaveLength(3);
  });
}

for (const damage of ["missing", "malformed", "stale"]) {
  test(`${damage} layout falls back to one pane and resumes only registered sessions`, async ({
    page,
  }) => {
    const h = await server(page);
    await page.goto("/ghostty");
    await ready(page, 1);
    await split(page, 1, "right");
    await ready(page, 2);
    await page.evaluate((damage) => {
      const key = Object.keys(sessionStorage).find((key) =>
        key.endsWith(":layout"),
      )!;
      if (damage === "missing") sessionStorage.removeItem(key);
      else if (damage === "malformed") sessionStorage.setItem(key, "invalid");
      else {
        const saved = JSON.parse(sessionStorage.getItem(key)!);
        saved.ids.push("session-3");
        saved.activeId = "session-3";
        sessionStorage.setItem(key, JSON.stringify(saved));
      }
    }, damage);
    await page.reload();
    await expect.poll(() => h.attaches.length).toBe(4);
    expect(h.attaches.slice(2).sort()).toEqual([...h.sessions.keys()].sort());
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(input(page, 1)).toBeFocused();
    await expect(panel(page, 1)).toContainText("shell 1 output");
    await page.getByRole("button", { name: "/shell-2", exact: true }).click();
    await expect(panel(page, 2)).toContainText("shell 2 output");
  });
}

test("layout storage failure is visible and leaves live input and terminal replay intact", async ({
  page,
}) => {
  const h = await server(page);
  await page.goto("/ghostty");
  await ready(page, 1);
  await split(page, 1, "right");
  await ready(page, 2);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage && key.endsWith(":layout"))
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "/shell-1", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Pane layout could not be saved" }),
  ).toBeVisible();
  await page.keyboard.type("still-live");
  await expect.poll(() => [...h.sessions.values()][0].text).toBe("still-live");
  await page.reload();
  await expect.poll(() => h.attaches.length).toBe(4);
  await expect(panel(page, 1)).toContainText("shell 1 output");
  await expect(
    page.getByText("This session could not be restored", { exact: false }),
  ).toHaveCount(0);
});

test("a damaged terminal record keeps its pane while surviving shells resume", async ({
  page,
}) => {
  const h = await server(page);
  await page.goto("/ghostty");
  await ready(page, 1);
  await split(page, 1, "right");
  await ready(page, 2);
  await page.getByRole("button", { name: "/shell-1", exact: true }).click();
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((key) =>
      key.endsWith(":session-2.0"),
    )!;
    sessionStorage.setItem(key, "invalid");
  });
  await page.reload();
  await expect(page.getByRole("tabpanel")).toHaveCount(2);
  await expect(panel(page, 2)).toContainText(
    "This session could not be restored",
  );
  await expect(panel(page, 1)).toContainText("shell 1 output");
  await expect(input(page, 1)).toBeFocused();
  expect(h.attaches).toEqual([null, null, "1".repeat(64)]);
});
