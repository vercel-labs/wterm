import {
  OUTPUT_CHUNK,
  OUTPUT_FRAMES,
  OUTPUT_LOW_WATER,
  OUTPUT_PENDING_FRAMES,
  OUTPUT_PENDING_LIMIT,
  OUTPUT_WINDOW,
} from "./terminal-protocol";

interface OutputSink {
  send(data: Uint8Array): void;
  bufferedAmount(): number;
  pause(): void;
  resume(): void;
  finish(): void;
  fail(reason: string): void;
}

/** Credit counts bytes parsed by the browser, not bytes handed to TCP. */
export class PtyOutput {
  private queue: Uint8Array[] = [];
  private pending = 0;
  private sent = 0;
  private acknowledged = 0;
  private frames: number[] = [];
  private paused = false;
  private ended = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private sink: OutputSink) {}

  get pendingBytes(): number {
    return this.pending;
  }
  get outstandingBytes(): number {
    return this.sent - this.acknowledged;
  }
  get outstandingFrames(): number {
    return this.frames.length;
  }

  push(text: string | Uint8Array): void {
    if (this.stopped || this.ended || !text.length) return;
    const bytes =
      typeof text === "string" ? Buffer.byteLength(text) : text.byteLength;
    if (
      this.pending + bytes > OUTPUT_PENDING_LIMIT ||
      this.queue.length + Math.ceil(bytes / OUTPUT_CHUNK) >
        OUTPUT_PENDING_FRAMES
    ) {
      this.fail("Output exceeded the pending buffer limit");
      return;
    }
    const data =
      typeof text === "string" ? Buffer.from(text, "utf8") : Buffer.from(text);
    for (let i = 0; i < data.length; i += OUTPUT_CHUNK)
      this.queue.push(data.subarray(i, i + OUTPUT_CHUNK));
    this.pending += bytes;
    this.flush();
  }

  acknowledge(bytes: number): boolean {
    if (this.stopped) return false;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.sent) {
      this.fail("Invalid output acknowledgment");
      return false;
    }
    // Duplicate or delayed acknowledgments grant no additional credit.
    if (bytes <= this.acknowledged) return true;
    this.acknowledged = bytes;
    while (this.frames.length && this.frames[0] <= bytes) this.frames.shift();
    this.flush();
    return true;
  }

  end(): void {
    this.ended = true;
    this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.frames = [];
    this.pending = 0;
  }

  private fail(reason: string): void {
    this.stop();
    this.sink.fail(reason);
  }

  private flush(): void {
    if (this.stopped) return;
    for (let count = 0; this.queue.length && count < 64; count++) {
      const capacity = Math.min(
        OUTPUT_WINDOW - this.outstandingBytes,
        OUTPUT_WINDOW - this.sink.bufferedAmount(),
      );
      if (capacity <= 0 || this.frames.length >= OUTPUT_FRAMES) break;
      const head = this.queue[0];
      const size = Math.min(head.length, capacity);
      if (!Number.isSafeInteger(this.sent + size)) {
        this.fail("Output byte counter exceeded its limit");
        return;
      }
      const chunk = head.subarray(0, size);
      try {
        this.sink.send(chunk);
      } catch {
        this.fail("Unable to send terminal output");
        return;
      }
      this.sent += size;
      this.frames.push(this.sent);
      this.pending -= size;
      if (size === head.length) this.queue.shift();
      else this.queue[0] = head.subarray(size);
    }
    const blocked =
      this.pending > 0 ||
      this.outstandingBytes >= OUTPUT_WINDOW ||
      this.frames.length >= OUTPUT_FRAMES ||
      this.sink.bufferedAmount() >= OUTPUT_WINDOW;
    if (blocked && !this.paused && !this.ended) {
      this.paused = true;
      this.sink.pause();
    } else if (
      this.paused &&
      !this.ended &&
      !this.pending &&
      this.outstandingBytes <= OUTPUT_LOW_WATER &&
      this.frames.length <= OUTPUT_FRAMES / 4 &&
      this.sink.bufferedAmount() <= OUTPUT_LOW_WATER
    ) {
      this.paused = false;
      this.sink.resume();
    }
    if (this.ended && !this.pending && !this.outstandingBytes) {
      this.stop();
      this.sink.finish();
      return;
    }
    // ACKs wake a credit-blocked stream. Poll only for socket drain or a yielded batch.
    if (
      this.timer === null &&
      this.outstandingBytes < OUTPUT_WINDOW &&
      this.frames.length < OUTPUT_FRAMES &&
      (this.pending ||
        (this.paused && this.sink.bufferedAmount() > OUTPUT_LOW_WATER))
    ) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, 16);
    }
  }
}
