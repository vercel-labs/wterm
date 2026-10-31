import { acceptTerminal } from "./terminal-route";
import { expect, test, type WebSocketRoute } from "@playwright/test";

for (const path of ["/", "/ghostty"]) {
  test(`${path}: eight sessions consume output while only the active terminal paints`, async ({
    page,
  }) => {
    const sockets: WebSocketRoute[] = [];
    const sent: number[] = [];
    const consumed: number[] = [];
    const inputs: string[][] = [];
    await page.routeWebSocket("**/api/terminal", (socket) => {
      acceptTerminal(socket);
      const index = sockets.length;
      sockets.push(socket);
      sent.push(0);
      consumed.push(0);
      inputs.push([]);
      socket.onMessage((raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === "ack") consumed[index] = message.bytes;
        if (message.type === "input") inputs[index].push(message.data);
        if (message.type === "resize")
          socket.send(
            JSON.stringify({ type: "cwd", cwd: `/session-${index + 1}` }),
          );
      });
    });
    const send = (index: number, text: string) => {
      const bytes = Buffer.from(text);
      sent[index] += bytes.length;
      sockets[index].send(bytes);
    };
    const frames = () =>
      page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    await page.goto(path);
    for (let i = 1; i <= 8; i++) {
      if (i > 1)
        await page
          .getByRole("button", { name: "New terminal session", exact: true })
          .click();
      await expect(
        page.getByRole("button", { name: `/session-${i}`, exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("textbox", { name: "Terminal 8", exact: true }),
    ).toBeFocused();
    for (let i = 0; i < 8; i++) send(i, `seed ${i}`);
    await expect.poll(() => consumed).toEqual(sent);
    await frames();
    await page.evaluate(() => {
      const counters = Array.from(
        document.querySelectorAll(".term-grid"),
        (grid) => {
          const counter = { changes: 0 };
          new MutationObserver((records) => {
            counter.changes += records.length;
          }).observe(grid, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          return counter;
        },
      );
      Object.assign(window, { paintCounters: counters });
    });
    for (let step = 0; step < 12; step++) {
      for (let i = 0; i < 8; i++)
        send(i, `\r\x1b[2Kstream ${step} session ${i + 1} 語 😀\x1b[6n`);
      await expect.poll(() => [...consumed]).toEqual(sent);
      await frames();
    }
    // Terminal replies and consumption credit keep flowing in inactive panes.
    for (const replies of inputs)
      expect(replies.filter((s) => /\x1b\[\d+;\d+R/.test(s))).toHaveLength(12);
    await page.keyboard.type("foreground input");
    await expect.poll(() => inputs[7].join("")).toContain("foreground input");
    const changes = await page.evaluate(() =>
      (
        window as unknown as { paintCounters: { changes: number }[] }
      ).paintCounters.map((c) => c.changes),
    );
    expect(changes.slice(0, 7)).toEqual(Array(7).fill(0));
    expect(changes[7]).toBeGreaterThan(0);
    await page.getByRole("button", { name: "/session-1", exact: true }).click();
    await expect(
      page
        .getByRole("tabpanel", { name: "Terminal 1", exact: true })
        .locator(".term-row")
        .filter({ hasText: "stream 11 session 1 語 😀" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("textbox", { name: "Terminal 1", exact: true }),
    ).toBeFocused();
    expect(sockets).toHaveLength(8);
  });
}
