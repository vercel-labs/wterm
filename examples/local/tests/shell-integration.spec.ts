import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { acceptTerminal, terminalReady } from "./terminal-route";

const marker = (value: string) => `\x1b]133;${value}\x07`;
const pane = (page: Page, number: number) =>
  page.getByRole("tabpanel", { name: `Terminal ${number}`, exact: true });
const input = (page: Page, number: number) =>
  page.getByRole("textbox", { name: `Terminal ${number}`, exact: true });

async function open(page: Page, path = "/ghostty") {
  const sockets: WebSocketRoute[] = [],
    received: string[] = [],
    acknowledgments: number[] = [];
  await page.routeWebSocket("**/api/terminal", (socket) => {
    acceptTerminal(socket);
    const index = sockets.length;
    sockets.push(socket);
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "ack") acknowledgments[index] = message.bytes;
      if (message.type === "input") received.push(message.data);
    });
  });
  await page.goto(path);
  const ready = async (number: number) => {
    await expect(input(page, number)).toBeFocused();
    await expect.poll(() => sockets.length).toBeGreaterThanOrEqual(number);
    await terminalReady(sockets[number - 1]);
    sockets[number - 1].send(
      JSON.stringify({ type: "cwd", cwd: `/shell-${number}` }),
    );
  };
  await ready(1);
  return { sockets, received, acknowledgments, ready };
}

test("fragmented shell markers update command status even during synchronized output and reset cleanly", async ({
  page,
}) => {
  const h = await open(page);
  const first = pane(page, 1);
  const prefix = "\x1b]133;A";
  h.sockets[0].send(Buffer.from(prefix));
  await expect.poll(() => h.acknowledgments[0]).toBe(Buffer.byteLength(prefix));
  await expect(first.getByText("Ready", { exact: true })).toHaveCount(0);
  h.sockets[0].send(Buffer.from("\x1b\\prompt> " + marker("B")));
  await expect(first.getByText("Ready", { exact: true })).toBeVisible();
  h.sockets[0].send(Buffer.from("\x1b[?2026h" + marker("C") + "held-output"));
  await expect(first.getByText("Running", { exact: true })).toBeVisible();
  await expect(first.locator(".term-grid")).not.toContainText("held-output");
  h.sockets[0].send(
    Buffer.from(
      marker("D;7") + marker("A") + "next> " + marker("B") + "\x1b[?2026l",
    ),
  );
  await expect(first.getByText("Exit 7", { exact: true })).toBeVisible();
  await expect(first.locator(".term-grid")).toContainText("held-output");
  h.sockets[0].send(Buffer.from(marker("C")));
  await expect(first.getByText("Running", { exact: true })).toBeVisible();
  h.sockets[0].send(Buffer.from(marker("D;0") + marker("A") + marker("B")));
  await expect(first.getByText("Done", { exact: true })).toBeVisible();
  await expect(input(page, 1)).toBeFocused();
  expect(h.received).toEqual([]);
  h.sockets[0].send(Buffer.from("\x1bc"));
  await expect(first.getByText("Done", { exact: true })).toHaveCount(0);
  await page.keyboard.type("still usable");
  await expect.poll(() => h.received.join("")).toBe("still usable");
});

test("background commands keep their own status without repainting or stealing focus", async ({
  page,
}) => {
  const h = await open(page);
  h.sockets[0].send(
    Buffer.from("retained output\r\n" + marker("A") + marker("B")),
  );
  await expect(pane(page, 1).getByText("Ready", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "New terminal session", exact: true })
    .click();
  await h.ready(2);
  h.sockets[1].send(Buffer.from(marker("A") + marker("B")));
  await expect(pane(page, 2).getByText("Ready", { exact: true })).toBeVisible();
  const grid = page.locator("#pane-session-1 .term-grid");
  const original = await grid.textContent();
  h.sockets[0].send(Buffer.from(marker("C") + "background output\r\n"));
  await expect(
    page.getByTitle("Terminal 1: Running", { exact: true }),
  ).toBeVisible();
  h.sockets[0].send(Buffer.from(marker("D;9") + marker("A") + marker("B")));
  await expect(
    page.getByTitle("Terminal 1: Exit 9", { exact: true }),
  ).toBeVisible();
  expect(await grid.textContent()).toBe(original);
  await expect(input(page, 2)).toBeFocused();
  await expect(pane(page, 2).getByText("Ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "/shell-1", exact: true }).click();
  await expect(input(page, 1)).toBeFocused();
  await expect(
    pane(page, 1).getByText("Exit 9", { exact: true }),
  ).toBeVisible();
  await expect(grid).toContainText("background output");
  h.sockets[0].close({ code: 1000, reason: "Session ended" });
  await expect(pane(page, 1).getByText("Exit 9", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByTitle("Terminal 1: Exit 9", { exact: true }),
  ).toHaveCount(0);
  expect(h.received).toEqual([]);
});

test("the built-in core keeps working without shell-state support", async ({
  page,
}) => {
  const h = await open(page, "/");
  h.sockets[0].send(
    Buffer.from(marker("C") + "ordinary output\r\n" + marker("D;7")),
  );
  await expect(pane(page, 1).locator(".term-grid")).toContainText(
    "ordinary output",
  );
  await expect(pane(page, 1).getByText("Exit 7", { exact: true })).toHaveCount(
    0,
  );
  await page.keyboard.type("echo ok");
  await expect.poll(() => h.received.join("")).toBe("echo ok");
});
