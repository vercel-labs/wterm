import { expect, test } from "@playwright/test";

test("native WebSocket drains bounded messages in order with exact binary and UTF-8 bytes", async ({
  page,
}) => {
  await page.goto("/?core=builtin&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  const result = await page.evaluate(async () => {
    const { WebSocketTransport } = window.ptyHarness;
    const url = new URL("/transport", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const encoder = new TextEncoder();
    const messages: (string | Uint8Array)[] = [
      "語😀e\u0301\ud800\r\n",
      new Uint8Array([0, 1, 127, 128, 255]),
      ...Array.from({ length: 80 }, (_, i) => `${i}:` + "x".repeat(1024)),
    ];
    const expected = messages.map((message) =>
      Array.from(
        typeof message === "string" ? encoder.encode(message) : message,
      ),
    );
    const received: number[][] = [];
    const pressure: boolean[] = [];
    let maxObserved = 0;
    let binaryOnly = true;
    let complete: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const transport = new WebSocketTransport({
      url: url.href,
      maxBufferedBytes: 128 * 1024,
      highWaterMark: 4096,
      lowWaterMark: 1024,
      onData: (data) => {
        binaryOnly &&= data instanceof Uint8Array;
        received.push(Array.from(data as Uint8Array));
        maxObserved = Math.max(maxObserved, transport.bufferedAmount);
        if (received.length === messages.length) complete();
      },
      onBackpressure: (paused) => pressure.push(paused),
    });
    try {
      for (const message of messages) transport.send(message);
      (messages[1] as Uint8Array).fill(9);
      const before = transport.bufferedAmount;
      let rejected = false;
      try {
        transport.send("x".repeat(128 * 1024));
      } catch (error) {
        rejected = error instanceof RangeError;
      }
      const unchanged = transport.bufferedAmount === before;
      maxObserved = before;
      transport.connect();
      await Promise.race([
        done,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Transport echo timed out")),
            10000,
          ),
        ),
      ]);
      const deadline = performance.now() + 2000;
      while (
        (transport.backpressured || transport.bufferedAmount) &&
        performance.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        expected,
        received,
        pressure,
        rejected,
        unchanged,
        binaryOnly,
        maxObserved,
        buffered: transport.bufferedAmount,
        queued: transport.queuedMessages,
        paused: transport.backpressured,
      };
    } finally {
      transport.close();
    }
  });
  expect(result.received).toEqual(result.expected);
  expect(result.pressure).toEqual([true, false]);
  expect(result.rejected).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.binaryOnly).toBe(true);
  expect(result.maxObserved).toBeLessThanOrEqual(128 * 1024);
  expect(result.buffered).toBe(0);
  expect(result.queued).toBe(0);
  expect(result.paused).toBe(false);
});

test("close discards queued commands before a fresh connection", async ({
  page,
}) => {
  await page.goto("/?core=builtin&mode=replay");
  await expect(page.locator("#status")).toHaveText("Replay ready");
  const result = await page.evaluate(async () => {
    const { WebSocketTransport } = window.ptyHarness;
    const url = new URL("/transport", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const received: string[] = [];
    let complete: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const transport = new WebSocketTransport({
      url: url.href,
      onData: (data) => {
        received.push(new TextDecoder().decode(data as Uint8Array));
        complete();
      },
    });
    try {
      transport.send("discarded before connect");
      transport.close();
      let closedSendRejected = false;
      try {
        transport.send("discarded after close");
      } catch {
        closedSendRejected = true;
      }
      transport.connect();
      transport.send("fresh command");
      await Promise.race([
        done,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Transport echo timed out")),
            10000,
          ),
        ),
      ]);
      return { received, closedSendRejected };
    } finally {
      transport.close();
    }
  });
  expect(result.closedSendRejected).toBe(true);
  expect(result.received).toEqual(["fresh command"]);
});
