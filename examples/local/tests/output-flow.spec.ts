import { expect, test, type WebSocketRoute } from "@playwright/test";
import {
  INPUT_LIMIT,
  OUTPUT_CHUNK,
  OUTPUT_WINDOW,
} from "../lib/terminal-protocol";

for (const path of ["/", "/ghostty"]) {
  test(`${path}: bounded output drains through synchronized drawing and accepts input during a stream`, async ({
    page,
  }) => {
    let socket: WebSocketRoute;
    let sent = 0,
      acknowledged = 0,
      maxOutstanding = 0;
    const input: string[] = [];
    // Enough output to require many credit windows, including fragmented Unicode.
    const body = Buffer.from(
      "\x1b[?2026h\x1b[H" +
        Array.from({ length: 16000 }, (_, i) => `${i} 語 😀 e\u0301\r\n`).join(
          "",
        ) +
        "\x1b[?2026lflow complete",
    );
    const pump = () => {
      while (sent < body.length && sent - acknowledged < OUTPUT_WINDOW) {
        const length = Math.min(
          4093,
          body.length - sent,
          OUTPUT_WINDOW - (sent - acknowledged),
        );
        const chunk = body.subarray(sent, sent + length);
        sent += length;
        maxOutstanding = Math.max(maxOutstanding, sent - acknowledged);
        socket.send(chunk);
      }
    };
    await page.routeWebSocket("**/api/terminal", (ws) => {
      socket = ws;
      ws.onMessage((data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "ack") {
          expect(message.bytes).toBeGreaterThanOrEqual(acknowledged);
          expect(message.bytes).toBeLessThanOrEqual(sent);
          acknowledged = message.bytes;
          pump();
        } else if (message.type === "input") input.push(message.data);
      });
    });
    await page.goto(path);
    const terminal = page.getByRole("textbox", {
      name: "Terminal 1",
      exact: true,
    });
    await expect(terminal).toBeFocused();
    await expect.poll(() => !!socket).toBe(true);
    pump();
    await page.keyboard.type("echo alive");
    await expect.poll(() => input.join("")).toBe("echo alive");
    await expect.poll(() => acknowledged, { timeout: 15000 }).toBe(body.length);
    expect(maxOutstanding).toBeLessThanOrEqual(OUTPUT_WINDOW);
    await expect(
      page.locator(".term-row").filter({ hasText: "flow complete" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Read output" }).click();
    const output = page.getByRole("dialog").getByRole("textbox");
    await expect(output).toHaveValue(/15999 語 😀 e\u0301\nflow complete\n*$/);
  });
}

test("oversized output closes the connection and reports the failure", async ({
  page,
}) => {
  let socket: WebSocketRoute;
  let closed = false;
  await page.routeWebSocket("**/api/terminal", (ws) => {
    socket = ws;
    ws.onClose(() => {
      closed = true;
    });
  });
  await page.goto("/ghostty");
  await expect(
    page.getByRole("textbox", { name: "Terminal 1", exact: true }),
  ).toBeFocused();
  await expect.poll(() => !!socket).toBe(true);
  socket!.send(Buffer.alloc(OUTPUT_CHUNK + 1, "x"));
  await expect(
    page.getByRole("status").filter({ hasText: "buffer limit" }),
  ).toHaveText("Session ended because output exceeded its buffer limit.");
  await expect.poll(() => closed).toBe(true);
});

test("an oversized paste is rejected visibly and typing can continue", async ({
  page,
}) => {
  const input: string[] = [];
  let connected = false;
  await page.routeWebSocket("**/api/terminal", (ws) => {
    ws.onMessage((data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "resize") connected = true;
      if (message.type === "input") input.push(message.data);
    });
  });
  await page.goto("/ghostty");
  const terminal = page.getByRole("textbox", {
    name: "Terminal 1",
    exact: true,
  });
  await expect(terminal).toBeFocused();
  await expect.poll(() => connected).toBe(true);
  await terminal.evaluate((element, limit) => {
    // Supply deterministic clipboard data; synthetic ClipboardEvent payloads
    // are restricted in Firefox.
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "x".repeat(limit + 1) },
    });
    element.dispatchEvent(event);
  }, INPUT_LIMIT);
  await expect(
    page.getByRole("status").filter({ hasText: "Input was not sent" }),
  ).toContainText("too large");
  expect(input).toEqual([]);
  await page.keyboard.type("ok");
  await expect.poll(() => input.join("")).toBe("ok");
  await expect(page.getByText(/Input was not sent/)).toHaveCount(0);
});
