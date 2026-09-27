import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { TerminalCore } from "@wterm/core";

async function server(page: Page) {
  const sockets: WebSocketRoute[] = [];
  const attaches: { session: string | null; bytes: number }[] = [];
  const inputs: { id: number; data: string }[] = [];
  let acknowledged = 0;
  const sessions = new Map<string, number>();
  await page.routeWebSocket("**/api/terminal", (socket) => {
    let session: string;
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "attach") {
        sockets.push(socket);
        attaches.push(message);
        session =
          message.session ?? String.fromCharCode(97 + sessions.size).repeat(64);
        if (!sessions.has(session)) sessions.set(session, 0);
        socket.send(
          JSON.stringify({
            type: "ready",
            session,
            resumed: message.session !== null,
            input: sessions.get(session),
          }),
        );
      } else if (message.type === "input") {
        inputs.push(message);
        sessions.set(session, message.id);
        socket.send(JSON.stringify({ type: "input-ack", input: message.id }));
      } else if (message.type === "ack")
        acknowledged = Math.max(acknowledged, message.bytes);
    });
  });
  return { sockets, attaches, inputs, ack: () => acknowledged };
}
const terminal = (page: Page) =>
  page.getByRole("textbox", { name: "Terminal 1", exact: true });
const grid = (page: Page) => page.locator(".local-terminal .term-grid");

for (const route of ["/", "/ghostty"]) {
  test(`${route}: reload restores the same session through partial Unicode and escape sequences without replaying replies`, async ({
    page,
  }) => {
    const h = await server(page);
    await page.goto(route);
    await expect(terminal(page)).toBeFocused();
    await expect.poll(() => h.attaches.length).toBe(1);
    const output = Buffer.from(
      "retained history\r\n\x1b[?1049h\x1b[?2004happlication\x1b[6n\r\n語",
    );
    h.sockets[0].send(output.subarray(0, output.length - 1));
    await expect.poll(h.ack).toBe(output.length - 1);
    const replies = h.inputs.length;
    expect(replies).toBeGreaterThan(0);
    await page.reload();
    await expect.poll(() => h.attaches.length).toBe(2);
    expect(h.attaches[1]).toMatchObject({
      session: "a".repeat(64),
      bytes: output.length - 1,
    });
    await expect(grid(page)).toContainText("application");
    expect(h.inputs).toHaveLength(replies);
    h.sockets[1].send(
      Buffer.concat([
        output.subarray(output.length - 1),
        Buffer.from("\x1b[38;2;255;"),
      ]),
    );
    await expect(grid(page)).toContainText("語");
    await expect.poll(h.ack).toBe(output.length + 11);
    await page.reload();
    await expect.poll(() => h.attaches.length).toBe(3);
    h.sockets[2].send(Buffer.from("0;0mRED\x1b[0m\x1b[?1049l"));
    await expect(grid(page)).toContainText("retained history");
    await terminal(page).focus();
    await page.keyboard.type("new-input");
    expect(
      h.inputs
        .slice(replies)
        .map((value) => value.data)
        .join(""),
    ).toBe("new-input");
    expect(h.inputs[replies].id).toBe(replies + 1);
  });
}

test("expired sessions do not silently start replacement shells", async ({
  page,
}) => {
  let attachments = 0;
  await page.routeWebSocket("**/api/terminal", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== "attach") return;
      attachments++;
      if (message.session) socket.close({ code: 4404, reason: "Expired" });
      else
        socket.send(
          JSON.stringify({
            type: "ready",
            session: "b".repeat(64),
            resumed: false,
            input: 0,
          }),
        );
    });
  });
  await page.goto("/ghostty");
  await expect.poll(() => attachments).toBe(1);
  await expect(terminal(page)).toBeFocused();
  await page.reload();
  await expect(
    page.getByText("Session ended because it is no longer available."),
  ).toBeVisible();
  expect(attachments).toBe(2);
});

test("corrupt replay cannot start a replacement shell on reload", async ({
  page,
}) => {
  const h = await server(page);
  await page.goto("/ghostty");
  await expect.poll(() => h.attaches.length).toBe(1);
  await expect(terminal(page)).toBeFocused();
  h.sockets[0].send(Buffer.from("before reload"));
  await expect.poll(h.ack).toBe(13);
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((key) =>
      key.endsWith("session-1.0"),
    )!;
    sessionStorage.setItem(key, "invalid");
  });
  await page.reload();
  await expect(
    page.getByText(
      "This session could not be restored. Open a new terminal to start another shell.",
    ),
  ).toBeVisible();
  expect(h.attaches).toHaveLength(1);
});

test("storage denial disables recovery while output and input keep working", async ({
  page,
}) => {
  const h = await server(page);
  await page.goto("/ghostty");
  await expect(terminal(page)).toBeFocused();
  await expect.poll(() => h.attaches.length).toBe(1);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage && key.includes("recovery"))
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  h.sockets[0].send(Buffer.from("live output"));
  await expect(grid(page)).toContainText("live output");
  await expect(
    page.getByText(
      "Refresh recovery is unavailable for this session. Keep this page open to continue using it.",
    ),
  ).toBeVisible();
  await terminal(page).focus();
  await page.keyboard.type("still-live");
  expect(h.inputs.map((value) => value.data).join("")).toBe("still-live");
  await page.reload();
  await expect(
    page.getByText(
      "This session could not be restored. Open a new terminal to start another shell.",
    ),
  ).toBeVisible();
  expect(h.attaches).toHaveLength(1);
});

async function state(page: Page) {
  return page.evaluate(() => {
    const core = (window as unknown as { __wterm: { bridge: TerminalCore } })
      .__wterm.bridge;
    const graphics = core.getGraphicsState?.();
    return {
      cols: core.getCols(),
      rows: core.getRows(),
      cursor: core.getCursor(),
      screen: Array.from({ length: core.getRows() }, (_, row) =>
        Array.from({ length: core.getCols() }, (_, col) =>
          core.getCell(row, col),
        ),
      ),
      history: Array.from({ length: core.getScrollbackCount() }, (_, offset) =>
        Array.from({ length: core.getScrollbackLineLen(offset) }, (_, col) =>
          core.getScrollbackCell(offset, col),
        ),
      ),
      modes: [
        core.usingAltScreen(),
        core.bracketedPaste(),
        core.cursorKeysApp(),
        core.kittyKeyboardFlags?.(),
        core.mouseTracking?.(),
      ],
      colors: core.getColorOverrides?.(),
      // Cache generations can differ when React recreates a core in Strict Mode.
      images: graphics?.images.map(({ version, ...image }) => ({
        ...image,
        rgba: Array.from(core.getGraphicsImage!(image.imageId, version)!.rgba),
      })),
      placements: graphics?.placements.map((placement) => ({
        ...placement,
        imageVersion: undefined,
      })),
    };
  });
}

test("Ghostty reload preserves reflowed history, both screens, modes and Kitty pixels", async ({
  page,
}) => {
  const h = await server(page);
  await page.goto("/ghostty?debug");
  await expect(terminal(page)).toBeFocused();
  await expect.poll(() => h.attaches.length).toBe(1);
  const primary = Buffer.from(
    "wide 語 history line\r\n".repeat(40) +
      "\x1b_Ga=T,f=24,s=1,v=1,i=1;/wAA\x1b\\",
  );
  h.sockets[0].send(primary);
  await expect.poll(h.ack).toBe(primary.length);
  const oldCols = (await state(page)).cols;
  await page.setViewportSize({ width: 720, height: 640 });
  await expect.poll(async () => (await state(page)).cols).not.toBe(oldCols);
  const main = await state(page);
  expect(main.history.length).toBeGreaterThan(0);
  expect(main.images).toHaveLength(1);
  const alternate = Buffer.from(
    "\x1b[?1049h\x1b[?2004h\x1b[?1h\x1b[?1003h\x1b[>11u\x1b]11;#223344\x07\x1b[4:3;58;2;255;0;0mALT語\x1b_Ga=T,f=24,s=1,v=1,i=2;AP8A\x1b\\",
  );
  h.sockets[0].send(alternate);
  await expect.poll(h.ack).toBe(primary.length + alternate.length);
  const before = await state(page);
  expect(before.images).toHaveLength(1);
  const replies = h.inputs.length;
  await page.reload();
  await expect.poll(() => h.attaches.length).toBe(2);
  await expect.poll(() => state(page)).toEqual(before);
  expect(h.inputs).toHaveLength(replies);
  h.sockets[1].send(Buffer.from("\x1b[?1049l"));
  await expect
    .poll(async () => (await state(page)).screen)
    .toEqual(main.screen);
  const after = await state(page);
  expect(after.history).toEqual(main.history);
  expect(after.images).toEqual(main.images);
  expect(after.placements).toEqual(main.placements);
});

test("historical clipboard requests stay dismissed after restoring a Ghostty session", async ({
  page,
}) => {
  const h = await server(page);
  await page.goto("/ghostty");
  await expect.poll(() => h.attaches.length).toBe(1);
  const data = Buffer.from("\x1b]52;c;aGVsbG8=\x07");
  h.sockets[0].send(data);
  await expect.poll(h.ack).toBe(data.length);
  await page.reload();
  await expect.poll(() => h.attaches.length).toBe(2);
  await expect(
    page.getByRole("button", { name: "Review clipboard request", exact: true }),
  ).toHaveCount(0);
  await expect(grid(page)).toBeVisible();
});

test("reload keeps surviving tab identities and never reopens explicitly closed sessions", async ({
  page,
}) => {
  const h = await server(page);
  await page.goto("/ghostty");
  await expect.poll(() => h.attaches.length).toBe(1);
  h.sockets[0].send(Buffer.from("first shell"));
  await expect(grid(page)).toContainText("first shell");
  await page
    .getByRole("button", { name: "New terminal session", exact: true })
    .click();
  await expect.poll(() => h.attaches.length).toBe(2);
  h.sockets[1].send(Buffer.from("second shell"));
  await expect(page.getByRole("tabpanel").locator(".term-grid")).toContainText(
    "second shell",
  );
  await page
    .getByRole("button", { name: "New terminal session", exact: true })
    .click();
  await expect.poll(() => h.attaches.length).toBe(3);
  await page
    .getByRole("button", { name: "Close Terminal 3", exact: true })
    .click();
  await page.reload();
  await expect.poll(() => h.attaches.length).toBe(5);
  expect(
    h.attaches
      .slice(3)
      .map((value) => value.session)
      .sort(),
  ).toEqual(["a".repeat(64), "b".repeat(64)]);
  await expect(
    page.getByRole("button", { name: /^Close Terminal/ }),
  ).toHaveCount(2);
  await expect(terminal(page)).toBeFocused();
  await expect(page.getByRole("tabpanel").locator(".term-grid")).toContainText(
    "first shell",
  );
  await page.getByTitle("Terminal 2", { exact: true }).click();
  await expect(page.getByRole("tabpanel").locator(".term-grid")).toContainText(
    "second shell",
  );
  await page
    .getByRole("button", { name: "Close Terminal 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close Terminal 1", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Close Terminal/ }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: "New terminal session", exact: true })
      .first(),
  ).toBeVisible();
  expect(h.attaches).toHaveLength(5);
});

test("normal navigation starts independently from saved reload records", async ({
  page,
}) => {
  const h = await server(page);
  await page.goto("/ghostty");
  await expect.poll(() => h.attaches.length).toBe(1);
  h.sockets[0].send(Buffer.from("old shell"));
  await expect(grid(page)).toContainText("old shell");
  await page.goto("/ghostty?fresh");
  await expect.poll(() => h.attaches.length).toBe(2);
  expect(h.attaches[1]).toMatchObject({ session: null, bytes: 0 });
  await expect(grid(page)).not.toContainText("old shell");
});

test("replayed theme changes preserve terminal state and use the current appearance", async ({
  page,
}) => {
  const h = await server(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/ghostty?debug");
  await expect(terminal(page)).toBeFocused();
  await expect.poll(() => h.attaches.length).toBe(1);
  const prefix = Buffer.from("\x1b[31mred\x1b[0m\x1b[38;2;12;");
  h.sockets[0].send(prefix);
  await expect.poll(h.ack).toBe(prefix.length);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Appearance", exact: true });
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await page.keyboard.press("Escape");
  h.sockets[0].send(Buffer.from("34;56mcolor\x1b[0m"));
  await expect(grid(page)).toContainText("redcolor");
  const before = await state(page);
  await page.reload();
  await expect.poll(() => h.attaches.length).toBe(2);
  await expect.poll(() => state(page)).toEqual(before);
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(250, 250, 250)",
  );
});
