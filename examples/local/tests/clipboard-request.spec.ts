import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { acceptTerminal, terminalReady } from "./terminal-route";

function request(text: string) {
  return Buffer.from(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
}

async function openTerminal(page: Page, stub = true) {
  if (stub)
    await page.addInitScript(() => {
      const state = { writes: [] as string[], reads: 0, fail: false };
      Object.assign(window, { clipboardTest: state });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            if (state.fail) throw new DOMException("Denied", "NotAllowedError");
            state.writes.push(text);
          },
          readText: async () => {
            state.reads++;
            throw new Error("Unexpected read");
          },
        },
      });
    });
  let socket: WebSocketRoute;
  const input: string[] = [];
  await page.routeWebSocket("**/api/terminal", (ws) => {
    acceptTerminal(ws);
    socket = ws;
    ws.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "input") input.push(message.data);
    });
  });
  await page.goto("/ghostty");
  const terminal = page.getByRole("textbox", {
    name: "Terminal 1",
    exact: true,
  });
  await expect(terminal).toBeFocused();
  await expect.poll(() => !!socket).toBe(true);
  await terminalReady(socket!);
  return { socket: socket!, terminal, input };
}

const writes = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { clipboardTest: { writes: string[] } })
        .clipboardTest.writes,
  );

test("application copy requires review and copies the preview even when another request arrives", async ({
  page,
}) => {
  const { socket, terminal, input } = await openTerminal(page);
  const text = "語 e\u0301 😀\nsecond line";
  socket.send(request(text));
  const review = page.getByRole("button", { name: "Review clipboard request" });
  await expect(review).toBeVisible();
  await expect(terminal).toBeFocused();
  expect(await writes(page)).toEqual([]);
  await review.click();
  const dialog = page.getByRole("dialog", {
    name: "Terminal 1 clipboard request",
  });
  await expect(dialog.getByRole("heading")).toBeFocused();
  const preview = dialog.getByRole("textbox", {
    name: "Requested clipboard text",
  });
  await expect(preview).toHaveValue(text);
  await expect(preview).toHaveJSProperty("readOnly", true);
  socket.send(
    Buffer.concat([request("new request"), Buffer.from("new output")]),
  );
  await expect(
    page.locator(".term-row").filter({ hasText: "new output" }),
  ).toHaveCount(1);
  await expect(preview).toHaveValue(text);
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied.");
  expect(await writes(page)).toEqual([text]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(terminal).toBeFocused();
  await review.click();
  await expect(preview).toHaveValue("new request");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(input).toEqual([]);
});

test("clipboard reads stay unsupported and clear requests can be dismissed or explicitly accepted", async ({
  page,
}) => {
  const { socket, input } = await openTerminal(page);
  socket.send(Buffer.from("\x1b]52;c;?\x07after query"));
  await expect(
    page.locator(".term-row").filter({ hasText: "after query" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Review clipboard request" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { clipboardTest: { reads: number } })
          .clipboardTest.reads,
    ),
  ).toBe(0);
  expect(input).toEqual([]);
  socket.send(request("dismissed"));
  await page.getByRole("button", { name: "Dismiss clipboard request" }).click();
  expect(await writes(page)).toEqual([]);
  socket.send(request(""));
  await page.getByRole("button", { name: "Review clipboard request" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox")).toHaveValue("");
  await dialog.getByRole("button", { name: "Clear clipboard" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Clipboard cleared.");
  expect(await writes(page)).toEqual([""]);
});

test("denied clipboard access keeps the text available for native copy", async ({
  page,
}) => {
  const { socket, input } = await openTerminal(page);
  await page.evaluate(() => {
    (
      window as unknown as { clipboardTest: { fail: boolean } }
    ).clipboardTest.fail = true;
  });
  socket.send(request("select this"));
  await page.getByRole("button", { name: "Review clipboard request" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Copy failed.");
  await expect(dialog.getByRole("textbox")).toHaveValue("select this");
  await dialog.getByRole("textbox").selectText();
  expect(await writes(page)).toEqual([]);
  expect(input).toEqual([]);
});

test("the Copy button writes to the native clipboard during its user gesture", async ({
  page,
  context,
  browserName,
}) => {
  const { socket } = await openTerminal(page, false);
  // Exercise Chromium's allowed-permission path; denial is covered above.
  if (browserName === "chromium")
    await context.grantPermissions(["clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
  socket.send(request("native clipboard text"));
  await page.getByRole("button", { name: "Review clipboard request" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    const input = document.createElement("textarea");
    input.setAttribute("aria-label", "Paste check");
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+v" : "Control+v",
  );
  await expect(page.getByRole("textbox", { name: "Paste check" })).toHaveValue(
    "native clipboard text",
  );
});

test("background sessions retain their own requests without moving focus", async ({
  page,
}) => {
  const { socket: first, terminal, input } = await openTerminal(page);
  await page.getByRole("button", { name: "New terminal session" }).click();
  const second = page.getByRole("textbox", { name: "Terminal 2", exact: true });
  await expect(second).toBeFocused();
  first.send(request("background copy"));
  // The inactive pane consumes effects but remains inert and does not open UI.
  await expect(
    page.getByRole("button", {
      name: "Review clipboard request",
      includeHidden: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Review clipboard request" }),
  ).toHaveCount(0);
  await expect(second).toBeFocused();
  await page.locator("aside button[aria-pressed]").first().click();
  await expect(terminal).toBeFocused();
  await page.getByRole("button", { name: "Review clipboard request" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox")).toHaveValue("background copy");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review clipboard request" }),
  ).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
  expect(input).toEqual([]);
});

test("a late copy result cannot dismiss a newer request or reopen a closed review", async ({
  page,
}) => {
  const { socket, terminal } = await openTerminal(page);
  await page.evaluate(() => {
    navigator.clipboard.writeText = () =>
      new Promise<void>((resolve) => {
        Object.assign(window, { finishClipboardCopy: resolve });
      });
  });
  socket.send(request("original"));
  const review = page.getByRole("button", { name: "Review clipboard request" });
  await review.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Copy", exact: true }),
  ).toBeDisabled();
  socket.send(
    Buffer.concat([request("newer"), Buffer.from("request received")]),
  );
  await expect(
    page.locator(".term-row").filter({ hasText: "request received" }),
  ).toHaveCount(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(terminal).toBeFocused();
  await review.click();
  await expect(dialog.getByRole("textbox")).toHaveValue("newer");
  await page.evaluate(() =>
    (
      window as unknown as { finishClipboardCopy(): void }
    ).finishClipboardCopy(),
  );
  await expect(dialog.getByRole("status")).toHaveText("");
  await expect(dialog.getByRole("textbox")).toHaveValue("newer");
  await expect(
    dialog.getByRole("button", { name: "Copy", exact: true }),
  ).toBeEnabled();
});
