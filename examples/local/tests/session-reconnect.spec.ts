import { expect, test, type WebSocketRoute } from "@playwright/test";

for (const path of ["/", "/ghostty"]) {
  test(`${path}: resumes the existing parser through split Unicode and synchronized alternate-screen output`, async ({
    page,
  }) => {
    const token = "b".repeat(64);
    const unicode = Buffer.from("🙂");
    const prefix = Buffer.concat([
      Buffer.from("primary\r\n\x1b[?1049h\x1b[?2026h\x1b[Hmarker\r\n\x1b[31m"),
      unicode.subarray(0, 2),
    ]);
    const suffix = Buffer.concat([
      unicode.subarray(2),
      Buffer.from(" recovered\x1b[0m\x1b[?2026l\x1b[6n"),
    ]);
    const sockets: WebSocketRoute[] = [];
    const attachments: { session: string | null; bytes: number }[] = [];
    const input: string[] = [];
    let acknowledged = 0;
    let seeded = false;
    await page.routeWebSocket("**/api/terminal", (socket) => {
      const index = sockets.length;
      sockets.push(socket);
      socket.onMessage((raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === "attach") {
          attachments.push({ session: message.session, bytes: message.bytes });
          if (index === 0)
            socket.send(
              JSON.stringify({ type: "ready", session: token, resumed: false }),
            );
        } else if (message.type === "resize" && index === 0 && !seeded) {
          seeded = true;
          socket.send(prefix);
        } else if (message.type === "ack") acknowledged = message.bytes;
        else if (message.type === "input") input.push(message.data);
      });
    });
    await page.goto(path);
    const terminal = page.getByRole("textbox", {
      name: "Terminal 1",
      exact: true,
    });
    await expect(terminal).toBeFocused();
    const original = await terminal.elementHandle();
    await expect.poll(() => acknowledged).toBe(prefix.length);
    await page.keyboard.type("once");
    await expect.poll(() => input.join("")).toBe("once");
    sockets[0].close({ code: 4000, reason: "Connection interrupted" });
    await expect(
      page.getByRole("status").filter({ hasText: "Reconnecting" }),
    ).toBeVisible();
    await page.keyboard.type("offline");
    await expect.poll(() => attachments.length).toBe(2);
    expect(attachments).toEqual([
      { session: null, bytes: 0 },
      { session: token, bytes: prefix.length },
    ]);
    expect(input.join("")).toBe("once");
    sockets[1].send(
      JSON.stringify({ type: "ready", session: token, resumed: true }),
    );
    sockets[1].send(suffix);
    await expect.poll(() => acknowledged).toBe(prefix.length + suffix.length);
    await expect(page.locator(".term-grid")).toContainText("🙂 recovered");
    await expect(page.locator(".term-grid")).not.toContainText("�");
    await expect(page.locator(".term-grid")).toContainText("marker");
    await expect
      .poll(() => input.some((value) => /^\x1b\[\d+;\d+R$/.test(value)))
      .toBe(true);
    expect(await original!.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    await expect(terminal).toBeFocused();
    await expect(
      page.getByRole("status").filter({ hasText: "Reconnected" }),
    ).toContainText("not resent");
    await page
      .getByRole("button", { name: "Dismiss reconnection notice" })
      .click();
    await expect(terminal).toBeFocused();
    await expect(page.getByText("Reconnected.", { exact: false })).toHaveCount(
      0,
    );
    await page.keyboard.type("after");
    await expect
      .poll(() => input.filter((value) => !value.startsWith("\x1b[")).join(""))
      .toBe("onceafter");
    sockets[1].send(Buffer.from("\x1b[?1049l"));
    await expect(page.locator(".term-grid")).toContainText("primary");
    expect(sockets).toHaveLength(2);
  });
}

test("an unavailable session reports the loss without starting another shell", async ({
  page,
}) => {
  const attachments: unknown[] = [];
  await page.routeWebSocket("**/api/terminal", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "attach") {
        attachments.push(message.session);
        if (message.session === null)
          socket.send(
            JSON.stringify({
              type: "ready",
              session: "c".repeat(64),
              resumed: false,
            }),
          );
        else socket.close({ code: 4404, reason: "Session unavailable" });
      } else if (message.type === "resize") socket.close({ code: 4000 });
    });
  });
  await page.goto("/ghostty");
  await expect(
    page.getByRole("status").filter({ hasText: "no longer available" }),
  ).toBeVisible();
  expect(attachments).toEqual([null, "c".repeat(64)]);
});
