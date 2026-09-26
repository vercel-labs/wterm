import { expect, test, type WebSocketRoute } from "@playwright/test";

test("output announcements can be toggled without reconnecting or disturbing the reader", async ({
  page,
}) => {
  let socket: WebSocketRoute;
  let connections = 0;
  await page.routeWebSocket("**/api/terminal", (ws) => {
    socket = ws;
    connections++;
  });
  await page.goto("/ghostty");
  const terminal = page.getByRole("textbox", {
    name: "Terminal 1",
    exact: true,
  });
  await expect(terminal).toBeFocused();
  await expect.poll(() => !!socket).toBe(true);
  const toggle = page.getByRole("checkbox", { name: "Announce output" });
  const log = page.getByRole("log", { name: "Terminal output" });
  await expect(toggle).not.toBeChecked();
  await expect(log).toHaveCount(0);
  await toggle.check();
  await terminal.focus();
  socket!.send(Buffer.from("command result\r\n"));
  await expect(log).toHaveText("command result");
  await page.getByRole("button", { name: "Read output" }).click();
  const reader = page.getByRole("dialog", {
    name: "Terminal 1 output",
    exact: true,
  });
  await expect(reader.getByRole("textbox")).toHaveValue(/^command result\n/);
  socket!.send(Buffer.from("while reading\r\n"));
  await expect(
    page.locator(".term-row").filter({ hasText: "while reading" }),
  ).toHaveCount(1);
  await expect(page.locator(".term-announcements")).toHaveText("");
  await page.keyboard.press("Escape");
  await terminal.focus();
  socket!.send(Buffer.from("back in shell"));
  await expect(log).toHaveText("back in shell");
  await toggle.uncheck();
  await expect(log).toHaveCount(0);
  expect(connections).toBe(1);
});
