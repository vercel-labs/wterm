export interface WebSocketTransportOptions {
  url?: string;
  reconnect?: boolean;
  maxReconnectDelay?: number;
  /** Maximum queued bytes, including WebSocket.bufferedAmount. Default: 1 MiB. */
  maxBufferedBytes?: number;
  /** Maximum messages waiting in the transport queue. Default: 1,024. */
  maxBufferedMessages?: number;
  /** Pause feeding the socket at this byte threshold. Default: 64 KiB. */
  highWaterMark?: number;
  /** Resume feeding the socket at or below this threshold. Default: 16 KiB. */
  lowWaterMark?: number;
  onData?: (data: Uint8Array | string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (event: Event) => void;
  /** Called on pressure transitions; pause producers while true. */
  onBackpressure?: (paused: boolean) => void;
}

// Count before encoding so rejected pastes do not allocate another huge buffer.
function utf8Length(text: string, limit: number): number {
  let bytes = 0;
  for (let i = 0; i < text.length && bytes <= limit; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3; // Includes TextEncoder's replacement for lone surrogates.
  }
  return bytes;
}

export class WebSocketTransport {
  url: string | null;
  reconnect: boolean;
  maxReconnectDelay: number;
  readonly maxBufferedBytes: number;
  readonly maxBufferedMessages: number;
  readonly highWaterMark: number;
  readonly lowWaterMark: number;
  onData: ((data: Uint8Array | string) => void) | null;
  onOpen: (() => void) | null;
  onClose: (() => void) | null;
  onError: ((event: Event) => void) | null;
  onBackpressure: ((paused: boolean) => void) | null;

  private _ws: WebSocket | null = null;
  private _connectionUrl: string | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _drainTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = 1000;
  private _closed = false;
  private _buffer: Uint8Array<ArrayBuffer>[] = [];
  private _queuedBytes = 0;
  private _backpressured = false;
  private _socketPaused = false;

  constructor(options: WebSocketTransportOptions = {}) {
    this.url = options.url ?? null;
    this._connectionUrl = this.url;
    this.reconnect = options.reconnect !== false;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
    this.maxBufferedBytes = options.maxBufferedBytes ?? 1024 * 1024;
    this.maxBufferedMessages = options.maxBufferedMessages ?? 1024;
    this.highWaterMark =
      options.highWaterMark ?? Math.min(64 * 1024, this.maxBufferedBytes);
    this.lowWaterMark =
      options.lowWaterMark ?? Math.floor(this.highWaterMark / 4);
    if (
      !Number.isSafeInteger(this.maxBufferedBytes) ||
      this.maxBufferedBytes <= 0 ||
      !Number.isSafeInteger(this.maxBufferedMessages) ||
      this.maxBufferedMessages <= 0 ||
      !Number.isSafeInteger(this.highWaterMark) ||
      this.highWaterMark <= 0 ||
      this.highWaterMark > this.maxBufferedBytes ||
      !Number.isSafeInteger(this.lowWaterMark) ||
      this.lowWaterMark < 0 ||
      this.lowWaterMark >= this.highWaterMark
    ) {
      throw new RangeError("Invalid WebSocket buffer limits");
    }
    this.onData = options.onData ?? null;
    this.onOpen = options.onOpen ?? null;
    this.onClose = options.onClose ?? null;
    this.onError = options.onError ?? null;
    this.onBackpressure = options.onBackpressure ?? null;
  }

  connect(url?: string): void {
    const target = url ?? this.url;
    if (!target) throw new Error("No WebSocket URL provided");
    const previous = this._ws;
    if (
      !this._closed &&
      target === this._connectionUrl &&
      previous &&
      (previous.readyState === WebSocket.CONNECTING ||
        previous.readyState === WebSocket.OPEN)
    )
      return;

    // Construct first: a malformed URL must not dispose a working connection.
    const ws = new WebSocket(target);
    const oldTarget = this._connectionUrl ?? this.url;
    const changedUrl = oldTarget !== null && target !== oldTarget;
    this._cancelTimers();
    this._ws = ws;
    this._closed = false;
    this._socketPaused = false;
    this.url = target;
    this._connectionUrl = target;
    if (changedUrl) this._clearBuffer();
    if (previous) {
      this._detach(previous);
      previous.close();
    }
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      if (this._ws !== ws || this._closed) return;
      this._reconnectDelay = 1000;
      this._flushBuffer();
      if (this._ws === ws && !this._closed) this.onOpen?.();
    };
    ws.onmessage = (event: MessageEvent) => {
      if (this._ws !== ws || this._closed) return;
      this.onData?.(
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : (event.data as string),
      );
    };
    ws.onclose = () => {
      if (this._ws !== ws) return;
      this._ws = null;
      this._detach(ws);
      this._cancelTimers();
      this._socketPaused = false;
      // Only bytes still owned by the transport survive a lost connection.
      // Bytes handed to WebSocket.send have uncertain delivery and are never replayed.
      if (this.reconnect && !this._closed) this._scheduleReconnect();
      try {
        this._updatePressure();
      } finally {
        this.onClose?.();
      }
    };
    ws.onerror = (event) => {
      if (this._ws !== ws || this._closed) return;
      try {
        this.onError?.(event);
      } finally {
        if (this._ws === ws) ws.close();
      }
    };
    this._updatePressure();
  }

  /** Accept the complete message or throw; never enqueue a partial paste. */
  send(data: string | Uint8Array): void {
    if (this._closed) throw new Error("WebSocket transport is closed");
    const available = this.maxBufferedBytes - this.bufferedAmount;
    const bytes =
      typeof data === "string" ? utf8Length(data, available) : data.byteLength;
    if (bytes > available || this._buffer.length >= this.maxBufferedMessages) {
      throw new RangeError("WebSocket send buffer limit exceeded");
    }
    // Copy views, including Buffer/subarray inputs, so caller mutations cannot
    // change a pending command or keep an oversized backing buffer alive.
    const item =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : new Uint8Array(data);
    this._buffer.push(item);
    this._queuedBytes += item.byteLength;
    this._flushBuffer();
  }

  close(): void {
    this._closed = true;
    this._cancelTimers();
    this._clearBuffer();
    this._socketPaused = false;
    try {
      this._ws?.close();
    } finally {
      this._updatePressure();
    }
  }

  get connected(): boolean {
    return !this._closed && this._ws?.readyState === WebSocket.OPEN;
  }

  /** Bytes still queued here plus bytes buffered by the current open socket. */
  get bufferedAmount(): number {
    return this._queuedBytes + (this.connected ? this._ws!.bufferedAmount : 0);
  }

  get queuedBytes(): number {
    return this._queuedBytes;
  }

  get queuedMessages(): number {
    return this._buffer.length;
  }

  get backpressured(): boolean {
    return this._backpressured;
  }

  private _flushBuffer(): void {
    const ws = this._ws;
    if (ws && this.connected) {
      if (this._socketPaused && ws.bufferedAmount <= this.lowWaterMark)
        this._socketPaused = false;
      // Bound per-turn message work as well as bytes. Preserve message boundaries.
      for (
        let sent = 0;
        !this._socketPaused && this._buffer.length && sent < 64;
        sent++
      ) {
        const item = this._buffer[0];
        if (
          ws.bufferedAmount > 0 &&
          ws.bufferedAmount + item.byteLength > this.highWaterMark
        ) {
          this._socketPaused = true;
          break;
        }
        ws.send(item);
        this._buffer.shift();
        this._queuedBytes -= item.byteLength;
        if (ws.bufferedAmount >= this.highWaterMark) this._socketPaused = true;
      }
      if (
        (this._buffer.length || ws.bufferedAmount) &&
        this._drainTimer === null
      ) {
        this._drainTimer = setTimeout(() => {
          this._drainTimer = null;
          this._flushBuffer();
        }, 16);
      }
    }
    this._updatePressure();
  }

  private _updatePressure(): void {
    const bytes = this.bufferedAmount;
    const full = this._buffer.length >= this.maxBufferedMessages;
    const next = this._backpressured
      ? bytes > this.lowWaterMark || full
      : bytes >= this.highWaterMark || full;
    if (next === this._backpressured) return;
    this._backpressured = next;
    this.onBackpressure?.(next);
  }

  private _clearBuffer(): void {
    this._buffer = [];
    this._queuedBytes = 0;
  }

  private _cancelTimers(): void {
    if (this._reconnectTimer !== null) clearTimeout(this._reconnectTimer);
    if (this._drainTimer !== null) clearTimeout(this._drainTimer);
    this._reconnectTimer = this._drainTimer = null;
  }

  private _detach(ws: WebSocket): void {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
  }

  private _scheduleReconnect(): void {
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._closed && this.reconnect) this.connect();
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(
      this._reconnectDelay * 2,
      this.maxReconnectDelay,
    );
  }
}
