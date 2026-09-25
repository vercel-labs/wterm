import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketTransport } from "../transport.js";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = "blob";
  bufferedAmount = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sent: (string | ArrayBufferView)[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string | ArrayBufferView) {
    this.sent.push(data);
    this.bufferedAmount +=
      typeof data === "string"
        ? new TextEncoder().encode(data).length
        : data.byteLength;
  }

  close() {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  simulateMessage(data: string | ArrayBuffer) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  simulateError() {
    this.onerror?.(new Event("error"));
  }
}

let mockInstances: MockWebSocket[] = [];

function installMockWebSocket() {
  mockInstances = [];
  vi.stubGlobal(
    "WebSocket",
    Object.assign(
      class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          mockInstances.push(this);
        }
      },
      {
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3,
      },
    ),
  );
}

describe("WebSocketTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMockWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("sets defaults", () => {
      const t = new WebSocketTransport();
      expect(t.url).toBeNull();
      expect(t.reconnect).toBe(true);
      expect(t.maxReconnectDelay).toBe(30000);
    });

    it("accepts options", () => {
      const t = new WebSocketTransport({
        url: "ws://localhost:3000",
        reconnect: false,
        maxReconnectDelay: 5000,
      });
      expect(t.url).toBe("ws://localhost:3000");
      expect(t.reconnect).toBe(false);
      expect(t.maxReconnectDelay).toBe(5000);
    });
  });

  describe("connect", () => {
    it("creates a WebSocket connection", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      expect(mockInstances).toHaveLength(1);
      expect(mockInstances[0].url).toBe("ws://test");
    });

    it("accepts URL parameter", () => {
      const t = new WebSocketTransport();
      t.connect("ws://override");
      expect(t.url).toBe("ws://override");
      expect(mockInstances[0].url).toBe("ws://override");
    });

    it("throws without URL", () => {
      const t = new WebSocketTransport();
      expect(() => t.connect()).toThrow("No WebSocket URL provided");
    });

    it("sets binaryType to arraybuffer", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      expect(mockInstances[0].binaryType).toBe("arraybuffer");
    });
  });

  describe("callbacks", () => {
    it("calls onOpen when connection opens", () => {
      const onOpen = vi.fn();
      const t = new WebSocketTransport({ url: "ws://test", onOpen });
      t.connect();
      mockInstances[0].simulateOpen();
      expect(onOpen).toHaveBeenCalledOnce();
    });

    it("calls onData for string messages", () => {
      const onData = vi.fn();
      const t = new WebSocketTransport({ url: "ws://test", onData });
      t.connect();
      mockInstances[0].simulateOpen();
      mockInstances[0].simulateMessage("hello");
      expect(onData).toHaveBeenCalledWith("hello");
    });

    it("calls onData with Uint8Array for binary messages", () => {
      const onData = vi.fn();
      const t = new WebSocketTransport({ url: "ws://test", onData });
      t.connect();
      mockInstances[0].simulateOpen();
      const buf = new ArrayBuffer(3);
      mockInstances[0].simulateMessage(buf);
      expect(onData).toHaveBeenCalledWith(expect.any(Uint8Array));
    });

    it("calls onClose when connection closes", () => {
      const onClose = vi.fn();
      const t = new WebSocketTransport({
        url: "ws://test",
        onClose,
        reconnect: false,
      });
      t.connect();
      mockInstances[0].simulateOpen();
      mockInstances[0].close();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onError on error", () => {
      const onError = vi.fn();
      const t = new WebSocketTransport({
        url: "ws://test",
        onError,
        reconnect: false,
      });
      t.connect();
      mockInstances[0].simulateError();
      expect(onError).toHaveBeenCalledOnce();
    });
  });

  describe("send", () => {
    it("sends data through open connection", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      mockInstances[0].simulateOpen();
      t.send("test data");
      expect(mockInstances[0].sent).toHaveLength(1);
    });

    it("buffers data when not connected", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      t.send("buffered");
      expect(mockInstances[0].sent).toHaveLength(0);
    });

    it("flushes buffer on open", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      t.send("msg1");
      t.send("msg2");
      mockInstances[0].simulateOpen();
      expect(mockInstances[0].sent).toHaveLength(2);
    });
  });

  describe("close", () => {
    it("closes the connection", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      t.close();
      expect(mockInstances[0].closed).toBe(true);
    });

    it("prevents reconnection", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      t.close();
      vi.advanceTimersByTime(60000);
      expect(mockInstances).toHaveLength(1);
    });
  });

  describe("connected", () => {
    it("returns false before connect", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      expect(t.connected).toBe(false);
    });

    it("returns true when open", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      mockInstances[0].simulateOpen();
      expect(t.connected).toBe(true);
    });

    it("returns false after close", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      mockInstances[0].simulateOpen();
      t.close();
      expect(t.connected).toBe(false);
    });
  });

  describe("reconnect", () => {
    it("reconnects after unexpected close", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      mockInstances[0].simulateOpen();
      mockInstances[0].close();

      vi.advanceTimersByTime(1000);
      expect(mockInstances).toHaveLength(2);
    });

    it("doubles delay on subsequent reconnects", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      mockInstances[0].close();

      vi.advanceTimersByTime(1000);
      expect(mockInstances).toHaveLength(2);

      mockInstances[1].close();
      vi.advanceTimersByTime(1999);
      expect(mockInstances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(mockInstances).toHaveLength(3);
    });

    it("caps reconnect delay at maxReconnectDelay", () => {
      const t = new WebSocketTransport({
        url: "ws://test",
        maxReconnectDelay: 4000,
      });
      t.connect();

      for (let i = 0; i < 10; i++) {
        mockInstances[mockInstances.length - 1].close();
        vi.advanceTimersByTime(4000);
      }
      expect(mockInstances.length).toBeGreaterThan(5);
    });

    it("resets delay after successful open", () => {
      const t = new WebSocketTransport({ url: "ws://test" });
      t.connect();
      mockInstances[0].close();
      vi.advanceTimersByTime(1000);
      mockInstances[1].simulateOpen();
      mockInstances[1].close();

      vi.advanceTimersByTime(1000);
      expect(mockInstances).toHaveLength(3);
    });

    it("does not reconnect when reconnect is false", () => {
      const t = new WebSocketTransport({
        url: "ws://test",
        reconnect: false,
      });
      t.connect();
      mockInstances[0].close();

      vi.advanceTimersByTime(60000);
      expect(mockInstances).toHaveLength(1);
    });
  });
});

describe("bounded transport buffering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMockWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const decoded = (ws: MockWebSocket) =>
    ws.sent.map((bytes) => new TextDecoder().decode(bytes as Uint8Array));

  it("rejects a whole message before allocating or changing the queue", () => {
    const transport = new WebSocketTransport({ maxBufferedBytes: 8 });
    transport.send("語😀");
    expect(transport.bufferedAmount).toBe(7);
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    expect(() => transport.send("x".repeat(1000000))).toThrow(RangeError);
    expect(encode).not.toHaveBeenCalled();
    encode.mockRestore();
    expect(transport.queuedBytes).toBe(7);
    expect(transport.queuedMessages).toBe(1);
    transport.send("!");
    transport.connect("ws://test");
    mockInstances[0].simulateOpen();
    expect(decoded(mockInstances[0])).toEqual(["語😀", "!"]);
  });

  it("counts lone surrogates exactly as TextEncoder does", () => {
    const transport = new WebSocketTransport({ maxBufferedBytes: 9 });
    transport.send("\ud800x\udc00é");
    expect(transport.bufferedAmount).toBe(9);
    expect(() => transport.send("x")).toThrow(RangeError);
    transport.connect("ws://test");
    mockInstances[0].simulateOpen();
    expect(decoded(mockInstances[0])).toEqual(["�x�é"]);
  });

  it("copies only the supplied binary view before buffering", () => {
    const transport = new WebSocketTransport();
    const backing = new Uint8Array(100000);
    const view = backing.subarray(100, 103);
    view.set([1, 2, 3]);
    transport.send(view);
    view.fill(9);
    transport.connect("ws://test");
    mockInstances[0].simulateOpen();
    const sent = mockInstances[0].sent[0] as Uint8Array;
    expect([...sent]).toEqual([1, 2, 3]);
    expect(sent.buffer.byteLength).toBe(3);
    expect(transport.queuedBytes).toBe(0);
  });

  it("bounds message overhead including empty messages", () => {
    const onBackpressure = vi.fn();
    const transport = new WebSocketTransport({
      maxBufferedMessages: 2,
      onBackpressure,
    });
    transport.send("");
    transport.send("");
    expect(transport.backpressured).toBe(true);
    expect(() => transport.send("")).toThrow(RangeError);
    expect(transport.queuedMessages).toBe(2);
    expect(transport.bufferedAmount).toBe(0);
    transport.connect("ws://test");
    mockInstances[0].simulateOpen();
    expect(decoded(mockInstances[0])).toEqual(["", ""]);
    expect(onBackpressure.mock.calls).toEqual([[true], [false]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("applies the byte cap to the transport and socket buffers together", () => {
    const transport = new WebSocketTransport({
      url: "ws://test",
      maxBufferedBytes: 10,
      highWaterMark: 6,
      lowWaterMark: 2,
    });
    transport.connect();
    const ws = mockInstances[0];
    ws.simulateOpen();
    transport.send("123456");
    transport.send("7890");
    expect(transport.bufferedAmount).toBe(10);
    expect(transport.queuedBytes).toBe(4);
    expect(() => transport.send("!")).toThrow(RangeError);
    expect(decoded(ws)).toEqual(["123456"]);
    ws.bufferedAmount = 2;
    vi.advanceTimersByTime(16);
    expect(decoded(ws)).toEqual(["123456", "7890"]);
    expect(transport.bufferedAmount).toBe(6);
  });

  it("drains in order with hysteresis and stops polling when idle", () => {
    const onBackpressure = vi.fn();
    const transport = new WebSocketTransport({
      url: "ws://test",
      highWaterMark: 8,
      lowWaterMark: 2,
      onBackpressure,
    });
    for (const message of ["12345678", "abcd", "ef"]) transport.send(message);
    expect(onBackpressure.mock.calls).toEqual([[true]]);
    expect(vi.getTimerCount()).toBe(0); // No disconnected polling.
    transport.connect();
    const ws = mockInstances[0];
    ws.simulateOpen();
    expect(decoded(ws)).toEqual(["12345678"]);
    ws.bufferedAmount = 3;
    vi.advanceTimersByTime(32);
    expect(decoded(ws)).toEqual(["12345678"]);
    ws.bufferedAmount = 2;
    vi.advanceTimersByTime(16);
    expect(decoded(ws)).toEqual(["12345678", "abcd", "ef"]);
    expect(transport.queuedMessages).toBe(0);
    expect(transport.backpressured).toBe(true);
    ws.bufferedAmount = 2;
    vi.advanceTimersByTime(16);
    expect(onBackpressure.mock.calls).toEqual([[true], [false]]);
    ws.bufferedAmount = 0;
    vi.advanceTimersByTime(16);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a message larger than the high-water mark without splitting it", () => {
    const transport = new WebSocketTransport({
      url: "ws://test",
      highWaterMark: 4,
      lowWaterMark: 1,
      maxBufferedBytes: 12,
    });
    transport.connect();
    const ws = mockInstances[0];
    ws.simulateOpen();
    transport.send("a");
    transport.send("12345678");
    expect(decoded(ws)).toEqual(["a"]);
    vi.advanceTimersByTime(16);
    expect(decoded(ws)).toEqual(["a"]);
    ws.bufferedAmount = 0;
    vi.advanceTimersByTime(16);
    expect(decoded(ws)).toEqual(["a", "12345678"]);
    expect(transport.bufferedAmount).toBe(8);
  });

  it("yields while draining many small messages", () => {
    const transport = new WebSocketTransport({ url: "ws://test" });
    for (let i = 0; i < 130; i++) transport.send(String(i));
    transport.connect();
    const ws = mockInstances[0];
    ws.simulateOpen();
    expect(ws.sent).toHaveLength(64);
    transport.send("last");
    vi.advanceTimersByTime(16);
    expect(decoded(ws)).toEqual([
      ...Array.from({ length: 130 }, (_, i) => String(i)),
      "last",
    ]);
    expect(transport.queuedBytes).toBe(0);
  });

  it("reconnects only unsent messages and never replays uncertain delivery", () => {
    const transport = new WebSocketTransport({
      url: "ws://test",
      highWaterMark: 4,
      lowWaterMark: 1,
    });
    transport.connect();
    const first = mockInstances[0];
    first.simulateOpen();
    transport.send("sent");
    transport.send("waiting");
    first.close();
    expect(transport.bufferedAmount).toBe(7);
    expect(vi.getTimerCount()).toBe(1); // Reconnect only; no drain loop.
    vi.advanceTimersByTime(1000);
    const second = mockInstances[1];
    second.simulateOpen();
    expect(decoded(first)).toEqual(["sent"]);
    expect(decoded(second)).toEqual(["waiting"]);
  });

  it("explicit close clears pending data and timers and rejects sends until connect", () => {
    const onBackpressure = vi.fn();
    const transport = new WebSocketTransport({
      url: "ws://test",
      highWaterMark: 4,
      onBackpressure,
    });
    transport.connect();
    mockInstances[0].simulateOpen();
    transport.send("sent");
    transport.send("queued");
    transport.close();
    transport.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(transport.bufferedAmount).toBe(0);
    expect(transport.queuedMessages).toBe(0);
    expect(onBackpressure.mock.calls).toEqual([[true], [false]]);
    expect(() => transport.send("later")).toThrow("closed");
    transport.connect();
    mockInstances[1].simulateOpen();
    expect(decoded(mockInstances[1])).toEqual([]);
    transport.send("new");
    expect(decoded(mockInstances[1])).toEqual(["new"]);
  });

  it("does not send queued commands to a different URL", () => {
    const transport = new WebSocketTransport({ url: "ws://first" });
    transport.connect();
    const first = mockInstances[0];
    transport.send("old command");
    transport.connect("ws://second");
    mockInstances[1].simulateOpen();
    expect(first.closed).toBe(true);
    expect(decoded(mockInstances[1])).toEqual([]);
    expect(transport.bufferedAmount).toBe(0);
  });

  it("ignores delayed callbacks from replaced sockets", () => {
    const onData = vi.fn(),
      onOpen = vi.fn(),
      onClose = vi.fn(),
      onError = vi.fn();
    const transport = new WebSocketTransport({
      url: "ws://first",
      onData,
      onOpen,
      onClose,
      onError,
    });
    transport.connect();
    const first = mockInstances[0];
    const callbacks = {
      open: first.onopen,
      message: first.onmessage,
      close: first.onclose,
      error: first.onerror,
    };
    transport.connect("ws://second");
    callbacks.open?.(new Event("open"));
    callbacks.message?.(new MessageEvent("message", { data: "stale" }));
    callbacks.close?.();
    callbacks.error?.(new Event("error"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(mockInstances[1].closed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    "honors public URL changes without carrying old commands (connected: %s)",
    (connected) => {
      const transport = new WebSocketTransport({ url: "ws://first" });
      if (connected) transport.connect();
      transport.send("old command");
      transport.url = "ws://second";
      transport.connect();
      expect(mockInstances).toHaveLength(connected ? 2 : 1);
      const ws = mockInstances[mockInstances.length - 1];
      ws.simulateOpen();
      expect(ws.url).toBe("ws://second");
      expect(decoded(ws)).toEqual([]);
    },
  );

  it("does not create duplicate sockets or leave a retry after manual reconnect", () => {
    const transport = new WebSocketTransport({ url: "ws://test" });
    transport.connect();
    transport.connect();
    expect(mockInstances).toHaveLength(1);
    mockInstances[0].close();
    transport.connect();
    vi.advanceTimersByTime(1000);
    expect(mockInstances).toHaveLength(2);
  });

  it("allows closing from pressure and close callbacks without leaking timers", () => {
    const transport = new WebSocketTransport({
      url: "ws://test",
      highWaterMark: 4,
      onBackpressure: (paused) => {
        if (paused) transport.close();
      },
      onClose: () => transport.close(),
    });
    transport.connect();
    mockInstances[0].simulateOpen();
    transport.send("four");
    expect(transport.connected).toBe(false);
    expect(transport.bufferedAmount).toBe(0);
    expect(transport.backpressured).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not close a replacement opened by an error callback", () => {
    const transport = new WebSocketTransport({
      url: "ws://first",
      onError: () => transport.connect("ws://second"),
    });
    transport.connect();
    mockInstances[0].simulateError();
    expect(mockInstances[1].closed).toBe(false);
  });

  it.each([
    { maxBufferedBytes: 0 },
    { maxBufferedBytes: Infinity },
    { maxBufferedMessages: 0 },
    { maxBufferedMessages: 1.5 },
    { highWaterMark: 0 },
    { highWaterMark: 9, maxBufferedBytes: 8 },
    { lowWaterMark: -1 },
    { highWaterMark: 4, lowWaterMark: 4 },
    { lowWaterMark: NaN },
  ])("rejects invalid limits %j", (options) => {
    expect(() => new WebSocketTransport(options)).toThrow(RangeError);
  });
});
