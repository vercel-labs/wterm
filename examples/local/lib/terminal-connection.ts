import {
  CONTROL_RESERVE,
  INPUT_LIMIT,
  OUTPUT_CHUNK,
  OUTPUT_FRAMES,
  OUTPUT_WINDOW,
  type ClientMessage,
} from "./terminal-protocol";

interface ConnectionCallbacks {
  write(data: Uint8Array): void;
  open(): void;
  cwd(path: string): void;
  end(message: string): void;
  inputError(message: string | null): void;
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

  constructor(
    private socket: WebSocket,
    private callbacks: ConnectionCallbacks,
  ) {
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (!this.stopped) callbacks.open();
    };
    socket.onmessage = (event) => {
      if (this.stopped || this.ended !== null) return;
      if (event.data instanceof ArrayBuffer) {
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
          if (message?.type !== "cwd" || typeof message.cwd !== "string")
            throw new Error();
          callbacks.cwd(message.cwd);
        } catch {
          this.fail("Session ended because its connection was incompatible.");
        }
      } else
        this.fail("Session ended because its connection was incompatible.");
    };
    socket.onclose = (event) => {
      if (this.stopped) return;
      this.ended =
        event.code === 1000
          ? "Session ended."
          : "Session ended because the connection was interrupted.";
      this.clearControlTimer();
      // A close event can arrive before the scheduled parser task.
      this.schedule();
    };
    socket.onerror = () => {
      if (!this.stopped) socket.close();
    };
  }

  get connected(): boolean {
    return !this.stopped && this.ended === null && this.socket.readyState === 1;
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
      this.socket.bufferedAmount + bytes > INPUT_LIMIT
    ) {
      this.callbacks.inputError(
        "Input was not sent because the connection is busy or the paste is too large.",
      );
      return;
    }
    try {
      this.socket.send(message);
      this.callbacks.inputError(null);
    } catch {
      this.fail("Session ended because input could not be sent.");
    }
  }

  resize(cols: number, rows: number, width: number, height: number): void {
    if (this.stopped || this.ended !== null) return;
    this.resizeMessage = { type: "resize", cols, rows, width, height };
    this.flushControls();
  }

  close(): void {
    if (this.stopped) return;
    this.stop();
    this.socket.close();
  }

  private stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.clearControlTimer();
    this.queue = [];
    this.queuedBytes = 0;
    this.resizeMessage = null;
    this.socket.onopen =
      this.socket.onmessage =
      this.socket.onclose =
      this.socket.onerror =
        null;
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
    if (this.socket.bufferedAmount > INPUT_LIMIT) {
      if (this.controlTimer === null)
        this.controlTimer = setTimeout(() => {
          this.controlTimer = null;
          this.flushControls();
        }, 16);
      return;
    }
    try {
      if (this.resizeMessage) {
        this.socket.send(JSON.stringify(this.resizeMessage));
        this.resizeMessage = null;
      }
      if (this.consumed > this.ack) {
        this.socket.send(JSON.stringify({ type: "ack", bytes: this.consumed }));
        this.ack = this.consumed;
      }
    } catch {
      this.fail("Session ended because its connection was interrupted.");
    }
  }
}
