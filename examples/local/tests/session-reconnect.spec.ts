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
    let acceptedInput = 0;
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
              JSON.stringify({
                type: "ready",
                session: token,
                resumed: false,
                input: 0,
              }),
            );
        } else if (message.type === "resize" && index === 0 && !seeded) {
          seeded = true;
          socket.send(prefix);
        } else if (message.type === "ack") acknowledged = message.bytes;
        else if (message.type === "input") {
          input.push(message.data);
          acceptedInput = message.id;
          socket.send(
            JSON.stringify({ type: "input-ack", input: acceptedInput }),
          );
        }
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
      JSON.stringify({
        type: "ready",
        session: token,
        resumed: true,
        input: acceptedInput,
      }),
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
              input: 0,
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

for (const path of ["/", "/ghostty"]) {
  for (const loseInput of [false, true]) {
    test(`${path}: reconnect distinguishes ${loseInput ? "missing input" : "a lost input acknowledgment"}`, async ({
      page,
    }) => {
      const token = "d".repeat(64);
      const sockets: WebSocketRoute[] = [];
      const accepted: string[] = [];
      const observed: string[] = [];
      let input = 0;
      let dropInput = false;
      let sized = false;
      await page.routeWebSocket("**/api/terminal", (socket) => {
        const initial = sockets.length === 0;
        sockets.push(socket);
        socket.onMessage((raw) => {
          const message = JSON.parse(raw.toString());
          if (message.type === "attach") {
            socket.send(
              JSON.stringify({
                type: "ready",
                session: token,
                resumed: !initial,
                input,
              }),
            );
          } else if (message.type === "resize") {
            sized = true;
          } else if (message.type === "input") {
            observed.push(message.data);
            if (initial && dropInput) return;
            expect(message.id).toBe(input + 1);
            input = message.id;
            accepted.push(message.data);
            // Withhold all receipts on the first socket, then confirm the
            // accepted prefix in the replacement attachment's ready message.
            if (!initial)
              socket.send(JSON.stringify({ type: "input-ack", input }));
          }
        });
      });
      await page.goto(path);
      const terminal = page.getByRole("textbox", {
        name: "Terminal 1",
        exact: true,
      });
      await expect(terminal).toBeFocused();
      await expect.poll(() => sized).toBe(true);
      await page.keyboard.type("once");
      await expect.poll(() => accepted.join("")).toBe("once");
      if (loseInput) {
        dropInput = true;
        await page.keyboard.type("lost");
        await expect.poll(() => observed.join("")).toBe("oncelost");
      }
      sockets[0].close({ code: 4000 });
      const notice = page
        .getByRole("status")
        .filter({ hasText: "Reconnected." });
      await expect(notice).toBeVisible();
      if (loseInput)
        await expect(notice).toContainText(
          "did not reach the shell and was not resent",
        );
      else {
        await expect(notice).toContainText("Reconnected.");
        await expect(notice).not.toContainText("input");
      }
      // Automatic replies must not clear the specific loss notice.
      sockets[1].send(Buffer.from("\x1b[6n"));
      await expect
        .poll(() => accepted.some((value) => /^\x1b\[\d+;\d+R$/.test(value)))
        .toBe(true);
      await expect(notice).toBeVisible();
      await expect(terminal).toBeFocused();
      await page.keyboard.type("after");
      await expect
        .poll(() =>
          accepted.filter((value) => !value.startsWith("\x1b[")).join(""),
        )
        .toBe("onceafter");
      sockets[1].close({ code: 4000 });
      await expect.poll(() => sockets.length).toBe(3);
      await expect(notice).toBeVisible();
      if (loseInput)
        await expect(notice).toContainText("did not reach the shell");
      await page
        .getByRole("button", { name: "Dismiss reconnection notice" })
        .click();
      await expect(terminal).toBeFocused();
      await expect(notice).toHaveCount(0);
      sockets[2].close({ code: 4000 });
      await expect.poll(() => sockets.length).toBe(4);
      await expect(notice).toBeVisible();
      await expect(notice).not.toContainText("input");
    });
  }
}
