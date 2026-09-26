import {
  CONTROL_RESERVE,
  HANDSHAKE_MS,
  INPUT_LIMIT,
  OUTPUT_CHUNK,
  OUTPUT_FRAMES,
  OUTPUT_WINDOW,
  RECONNECT_MS,
  type ClientMessage,
} from "./terminal-protocol";

interface ConnectionCallbacks {
  write(data: Uint8Array): void;
  open(resumed: boolean): void;
  cwd(path: string): void;
  end(message: string): void;
  inputError(message: string | null): void;
  reconnecting(): void;
}

/** The browser acknowledges only complete chunks accepted by the terminal core. */
export class TerminalConnection {
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private received = 0;
  private consumed = 0;
  private ack = 0;
  private resizeMessage: Extract<ClientMessage, { type: "resize" }> | null =
    null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controlTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private ended: string | null = null;
  private socket: WebSocket | null = null;
  private session: string | null = null;
  private ready = false;
  private retryDeadline: number | null = null;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private createSocket: () => WebSocket,
    private callbacks: ConnectionCallbacks,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    if (this.retryDeadline !== null && Date.now() >= this.retryDeadline) {
      this.fail("Session ended because it could not reconnect in time.");
      return;
    }
    let socket: WebSocket;
    try {
      socket = this.createSocket();
    } catch {
      this.interrupt();
      return;
    }
    this.socket = socket;
    this.ready = false;
    this.handshakeTimer = setTimeout(
      () => this.interrupt(),
      Math.min(
        HANDSHAKE_MS,
        this.retryDeadline === null
          ? HANDSHAKE_MS
          : this.retryDeadline - Date.now(),
      ),
    );
    const current = () => !this.stopped && this.socket === socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (!current()) return;
      try {
        socket.send(
          JSON.stringify({
            type: "attach",
            session: this.session,
            bytes: this.consumed,
          }),
        );
      } catch {
        this.interrupt();
      }
    };
    socket.onmessage = (event) => {
      if (!current() || this.ended !== null) return;
      if (event.data instanceof ArrayBuffer) {
        if (!this.ready) {
          this.fail("Session ended because its connection was incompatible.");
          return;
        }
        const data = new Uint8Array(event.data);
        if (
          !data.length ||
          data.length > OUTPUT_CHUNK ||
          this.queuedBytes + data.length > OUTPUT_WINDOW ||
          this.queue.length >= OUTPUT_FRAMES ||
          !Number.isSafeInteger(this.received + data.length)
        ) {
          this.fail("Session ended because output exceeded its buffer limit.");
          return;
        }
        this.received += data.length;
        this.queue.push(data);
        this.queuedBytes += data.length;
        this.schedule();
      } else if (typeof event.data === "string") {
        try {
          if (event.data.length > CONTROL_RESERVE) throw new Error();
          const message = JSON.parse(event.data);
          if (
            !this.ready &&
            message?.type === "ready" &&
            typeof message.session === "string" &&
            /^[a-f0-9]{64}$/.test(message.session) &&
            message.resumed === (this.session !== null) &&
            (this.session === null || message.session === this.session)
          ) {
            const resumed = this.session !== null;
            this.session = message.session;
            this.ready = true;
            if (this.handshakeTimer !== null) clearTimeout(this.handshakeTimer);
            this.handshakeTimer = null;
            this.retryDeadline = null;
            this.retries = 0;
            this.ack = this.consumed;
            this.callbacks.open(resumed);
            this.flushControls();
          } else if (
            this.ready &&
            message?.type === "cwd" &&
            typeof message.cwd === "string"
          ) {
            this.callbacks.cwd(message.cwd);
          } else throw new Error();
        } catch {
          this.fail("Session ended because its connection was incompatible.");
        }
      } else
        this.fail("Session ended because its connection was incompatible.");
    };
    socket.onclose = (event) => {
      if (!current()) return;
      if ([1001, 1005, 1006, 1011, 1012, 4000].includes(event.code)) {
        this.interrupt();
        return;
      }
      this.ended =
        event.code === 1000
          ? "Session ended."
          : event.code === 4404
            ? "Session ended because it is no longer available."
            : event.code === 4409
              ? "Session ended because its output could not be restored."
              : "Session ended because the connection was interrupted.";
      this.ready = false;
      if (this.handshakeTimer !== null) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.clearControlTimer();
      // A close event can arrive before the scheduled parser task.
      this.schedule();
    };
    socket.onerror = () => {
      if (current()) this.interrupt();
    };
  }

  get connected(): boolean {
    return (
      !this.stopped &&
      this.ended === null &&
      this.ready &&
      this.socket?.readyState === 1
    );
  }

  private releaseSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (socket)
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    if (this.handshakeTimer !== null) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
    socket?.close(4000, "Connection interrupted");
  }

  private interrupt(): void {
    if (this.stopped || this.ended !== null) return;
    this.releaseSocket();
    this.clearControlTimer();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    // Discard only bytes that have not entered the core. The server retains
    // them until acknowledgment and will replay from the exact parsed offset.
    this.queue = [];
    this.queuedBytes = 0;
    this.received = this.consumed;
    this.retryDeadline ??= Date.now() + RECONNECT_MS;
    this.callbacks.reconnecting();
    if (this.retryTimer !== null) return;
    const delay = Math.min(
      250 * 2 ** Math.min(this.retries++, 3),
      Math.max(0, this.retryDeadline - Date.now()),
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  input(data: string): void {
    if (!this.connected) {
      this.callbacks.inputError(
        "Input was not sent because the session is disconnected.",
      );
      return;
    }
    // Reject before JSON/UTF-8 allocation when the string cannot possibly fit.
    if (data.length > INPUT_LIMIT) {
      this.callbacks.inputError(
        "Input was not sent because the paste is too large.",
      );
      return;
    }
    const message = JSON.stringify({ type: "input", data });
    const bytes = new TextEncoder().encode(message).length;
    if (
      bytes > INPUT_LIMIT ||
      this.socket!.bufferedAmount + bytes > INPUT_LIMIT
    ) {
      this.callbacks.inputError(
        "Input was not sent because the connection is busy or the paste is too large.",
      );
      return;
    }
    try {
      this.socket!.send(message);
      this.callbacks.inputError(null);
    } catch {
      this.interrupt();
    }
  }

  resize(cols: number, rows: number, width: number, height: number): void {
    if (this.stopped || this.ended !== null) return;
    this.resizeMessage = { type: "resize", cols, rows, width, height };
    this.flushControls();
  }

  close(): void {
    if (this.stopped) return;
    const socket = this.socket;
    if (socket?.readyState === 1) {
      try {
        socket.send(JSON.stringify({ type: "close" }));
      } catch {}
    }
    this.stop();
    socket?.close(1000, "Session closed");
  }

  private stop(): void {
    this.stopped = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.handshakeTimer !== null) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.clearControlTimer();
    this.queue = [];
    this.queuedBytes = 0;
    this.resizeMessage = null;
    if (this.socket)
      this.socket.onopen =
        this.socket.onmessage =
        this.socket.onclose =
        this.socket.onerror =
          null;
    this.socket = null;
    this.ready = false;
  }

  private fail(message: string): void {
    this.close();
    this.callbacks.end(message);
  }

  private clearControlTimer(): void {
    if (this.controlTimer !== null) clearTimeout(this.controlTimer);
    this.controlTimer = null;
  }

  private schedule(): void {
    if (this.timer !== null || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, 0);
  }

  private drain(): void {
    const deadline = performance.now() + 4;
    let bytes = 0;
    let count = 0;
    while (
      !this.stopped &&
      this.queue.length &&
      bytes < 32 * 1024 &&
      count < 64
    ) {
      if (bytes + this.queue[0].length > 32 * 1024) break;
      const chunk = this.queue.shift()!;
      this.queuedBytes -= chunk.length;
      try {
        this.callbacks.write(chunk);
      } catch {
        this.fail("Session ended because output could not be processed.");
        return;
      }
      if (this.stopped) return;
      this.consumed += chunk.length;
      this.received = Math.max(this.received, this.consumed);
      bytes += chunk.length;
      count++;
      if (performance.now() >= deadline) break;
    }
    if (this.stopped) return;
    if (this.queue.length) this.schedule();
    this.flushControls();
    if (this.ended !== null && !this.queue.length) {
      const message = this.ended;
      this.stop();
      this.callbacks.end(message);
    }
  }

  private flushControls(): void {
    if (!this.connected) return;
    if (!this.resizeMessage && this.consumed <= this.ack) return;
    if (this.socket!.bufferedAmount > INPUT_LIMIT) {
      if (this.controlTimer === null)
        this.controlTimer = setTimeout(() => {
          this.controlTimer = null;
          this.flushControls();
        }, 16);
      return;
    }
    try {
      if (this.resizeMessage) {
        this.socket!.send(JSON.stringify(this.resizeMessage));
        this.resizeMessage = null;
      }
      if (this.consumed > this.ack) {
        this.socket!.send(
          JSON.stringify({ type: "ack", bytes: this.consumed }),
        );
        this.ack = this.consumed;
      }
    } catch {
      this.interrupt();
    }
  }
}
