import { expect, test, type WebSocketRoute } from "@playwright/test";

for (const path of ["/", "/ghostty"]) {
  test(`${path}: reads unmounted history, preserves a snapshot, and refreshes without sending input`, async ({
    page,
  }) => {
    let socket: WebSocketRoute;
    const input: string[] = [];
    await page.routeWebSocket("**/api/terminal", (ws) => {
      socket = ws;
      ws.onMessage((message) => {
        if (typeof message === "string" && !message.startsWith("\x1b[RESIZE:"))
          input.push(message as string);
      });
    });
    await page.goto(path);
    const terminal = page.getByRole("textbox", {
      name: "Terminal 1",
      exact: true,
    });
    await expect(terminal).toBeFocused();
    await expect.poll(() => !!socket).toBe(true);
    const lines = Array.from(
      { length: 500 },
      (_, i) => `output ${String(i).padStart(3, "0")} 語 e\u0301 😀`,
    );
    socket!.send(JSON.stringify({ type: "output", data: lines.join("\r\n") }));
    await expect(
      page.locator(".term-row").filter({ hasText: "output 499" }),
    ).toHaveCount(1);
    expect(await page.locator(".term-row").count()).toBeLessThan(200);
    await expect(page.getByText(lines[0], { exact: true })).toHaveCount(0);

    // Reach the visible reader button using the terminal's keyboard exit.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+Tab");
    // macOS WebKit's default tab order skips buttons, so focus the opener
    // before activating it, as a screen reader's control navigation can do.
    const opener = page.getByRole("button", { name: "Read output" });
    await opener.focus();
    input.length = 0;
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Terminal 1 output",
      exact: true,
    });
    const output = dialog.getByRole("textbox", {
      name: "Terminal 1 output text",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toBeFocused();
    await expect(dialog.getByRole("status")).toHaveText("Output ready.");
    await expect(output).toHaveJSProperty("readOnly", true);
    await expect(output).toHaveValue(lines.join("\n"));
    await page.keyboard.press("Tab");
    await expect(output).toBeFocused();
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => output.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await page.keyboard.type("must not enter the shell");
    await expect(output).toHaveValue(lines.join("\n"));
    expect(input).toEqual([]);
    // Copy uses the native text field, independent of terminal selection.
    await output.selectText();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+c" : "Control+c",
    );
    const captured = await output.inputValue();
    socket!.send(JSON.stringify({ type: "output", data: "\r\nnew output" }));
    await expect(
      page.locator(".term-row").filter({ hasText: "new output" }),
    ).toHaveCount(1);
    await expect(output).toHaveValue(captured);
    await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(output).toHaveValue(`${captured}\nnew output`);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    // The browser's clipboard remains the snapshot copied before Refresh.
    await page.evaluate(() => {
      const field = document.createElement("textarea");
      field.id = "clipboard-check";
      field.setAttribute("aria-label", "Copied output");
      document.body.append(field);
      field.focus();
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+v" : "Control+v",
    );
    expect(
      (
        await page.getByRole("textbox", { name: "Copied output" }).inputValue()
      ).normalize("NFC"),
    ).toBe(captured.normalize("NFC"));
    expect(input).toEqual([]);
  });
}

test("closing a pending capture cancels it and the reader can reopen", async ({
  page,
}) => {
  let socket: WebSocketRoute;
  await page.routeWebSocket("**/api/terminal", (ws) => {
    socket = ws;
  });
  await page.goto("/ghostty");
  await expect(
    page.getByRole("textbox", { name: "Terminal 1", exact: true }),
  ).toBeFocused();
  await expect.poll(() => !!socket).toBe(true);
  socket!.send(
    JSON.stringify({ type: "output", data: "\x1b[?2026h\x1b[Hheld" }),
  );
  const opener = page.getByRole("button", { name: "Read output" });
  await opener.click();
  const dialog = page.getByRole("dialog", {
    name: "Terminal 1 output",
    exact: true,
  });
  await expect(dialog.getByRole("status")).toHaveText("Reading output…");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  socket!.send(JSON.stringify({ type: "output", data: "\x1b[?2026l" }));
  await opener.click();
  await expect(dialog.getByRole("status")).toHaveText("Output ready.");
  await expect(dialog.getByRole("textbox")).toHaveValue(/^held/);
});

test("failed refresh retains the previous snapshot and can be retried", async ({
  page,
}) => {
  let socket: WebSocketRoute;
  await page.routeWebSocket("**/api/terminal", (ws) => {
    socket = ws;
  });
  await page.goto("/ghostty");
  await expect(
    page.getByRole("textbox", { name: "Terminal 1", exact: true }),
  ).toBeFocused();
  await expect.poll(() => !!socket).toBe(true);
  socket!.send(JSON.stringify({ type: "output", data: "old output" }));
  await page.getByRole("button", { name: "Read output" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Terminal 1 output",
    exact: true,
  });
  const output = dialog.getByRole("textbox");
  await expect(output).toHaveValue(/^old output\n/);
  const previous = await output.inputValue();
  socket!.send(
    JSON.stringify({ type: "output", data: "\x1b[?2026h\x1b[Hnew output" }),
  );
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Reading output…");
  socket!.send(JSON.stringify({ type: "output", data: "\x1b[?2026l" }));
  await expect(dialog.getByRole("status")).toHaveText(
    "Output changed while being read. Refresh to try again.",
  );
  await expect(output).toHaveValue(previous);
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Output ready.");
  await expect(output).toHaveValue(/^new output\n/);
});
