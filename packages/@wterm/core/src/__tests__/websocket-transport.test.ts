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
