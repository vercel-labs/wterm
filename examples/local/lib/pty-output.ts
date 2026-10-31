import {
  OUTPUT_CHUNK,
  OUTPUT_FRAMES,
  OUTPUT_LOW_WATER,
  OUTPUT_PENDING_FRAMES,
  OUTPUT_PENDING_LIMIT,
  OUTPUT_WINDOW,
} from "./terminal-protocol";
import { PtyOutputQueue } from "./pty-output-queue.mts";

interface OutputSink {
  send(data: Uint8Array): void;
  bufferedAmount(): number;
  pause(): void;
  resume(): void;
  finish(): void;
  fail(reason: string): void;
  disconnect?(): void;
}

/** Credit counts bytes parsed by the browser, not bytes handed to TCP. */
export class PtyOutput {
  private queue = new PtyOutputQueue(
    OUTPUT_PENDING_LIMIT,
    OUTPUT_PENDING_FRAMES,
    OUTPUT_CHUNK,
    () => this.flush(),
  );
  private sent = 0;
  private acknowledged = 0;
  private frames: { end: number; data: Uint8Array }[] = [];
  private attached = true;
  private replayCursor = 0;
  private paused = false;
  private ended = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private sink: OutputSink) {}

  get pendingBytes(): number {
    return this.queue.pendingBytes;
  }
  get outstandingBytes(): number {
    return this.sent - this.acknowledged;
  }
  get outstandingFrames(): number {
    return this.frames.length;
  }

  canResume(bytes: number): boolean {
    return (
      !this.stopped &&
      Number.isSafeInteger(bytes) &&
      bytes >= this.acknowledged &&
      bytes <= this.sent
    );
  }

  detach(): void {
    if (this.stopped) return;
    this.attached = false;
    this.queue.cancel();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.paused && !this.ended) {
      this.paused = true;
      this.sink.pause();
    }
  }

  /** The existing browser core owns all bytes through this offset. */
  attach(bytes: number): boolean {
    if (this.attached || !this.canResume(bytes)) return false;
    this.acknowledge(bytes);
    this.replayCursor = bytes;
    this.attached = true;
    this.queue.cancel();
    this.flush();
    return true;
  }

  push(text: string | Uint8Array): void {
    if (this.stopped || this.ended || !text.length) return;
    if (!this.queue.push(text)) {
      this.fail("Output exceeded the pending buffer limit");
      return;
    }
    if (this.attached) this.queue.schedule();
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
    this.replayCursor = Math.max(this.replayCursor, bytes);
    while (this.frames.length && this.frames[0].end <= bytes)
      this.frames.shift();
    this.flush();
    return true;
  }

  end(): void {
    this.ended = true;
    this.queue.cancel();
    this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue.clear();
    this.frames = [];
  }

  private fail(reason: string): void {
    this.stop();
    this.sink.fail(reason);
  }

  private sendFailed(): void {
    if (!this.sink.disconnect) {
      this.fail("Unable to send terminal output");
      return;
    }
    this.detach();
    this.sink.disconnect();
  }

  private flush(): void {
    if (this.stopped || !this.attached || this.queue.batching) return;
    // Retransmitted bytes already count against the credit window. Keep their
    // original frame boundaries so replay cannot multiply queued frame count.
    for (let count = 0; this.replayCursor < this.sent && count < 64; count++) {
      const frame = this.frames.find(({ end }) => end > this.replayCursor)!;
      const chunk = frame.data.subarray(
        this.replayCursor - (frame.end - frame.data.length),
      );
      if (this.sink.bufferedAmount() + chunk.length > OUTPUT_WINDOW) break;
      try {
        this.sink.send(chunk);
      } catch {
        this.sendFailed();
        return;
      }
      this.replayCursor = frame.end;
    }
    for (let count = 0; this.pendingBytes && count < 64; count++) {
      if (this.replayCursor < this.sent) break;
      const capacity = Math.min(
        OUTPUT_WINDOW - this.outstandingBytes,
        OUTPUT_WINDOW - this.sink.bufferedAmount(),
      );
      if (capacity <= 0 || this.frames.length >= OUTPUT_FRAMES) break;
      const chunk = this.queue.peek(capacity);
      const size = chunk.length;
      if (!Number.isSafeInteger(this.sent + size)) {
        this.fail("Output byte counter exceeded its limit");
        return;
      }
      try {
        this.sink.send(chunk);
      } catch {
        this.sendFailed();
        return;
      }
      this.sent += size;
      this.frames.push({ end: this.sent, data: chunk });
      this.replayCursor = this.sent;
      this.queue.consume(size);
    }
    const blocked =
      this.pendingBytes > 0 ||
      this.outstandingBytes >= OUTPUT_WINDOW ||
      this.frames.length >= OUTPUT_FRAMES ||
      this.sink.bufferedAmount() >= OUTPUT_WINDOW;
    if (blocked && !this.paused && !this.ended) {
      this.paused = true;
      this.sink.pause();
    } else if (
      this.paused &&
      !this.ended &&
      !this.pendingBytes &&
      this.outstandingBytes <= OUTPUT_LOW_WATER &&
      this.frames.length <= OUTPUT_FRAMES / 4 &&
      this.sink.bufferedAmount() <= OUTPUT_LOW_WATER
    ) {
      this.paused = false;
      this.sink.resume();
    }
    if (this.ended && !this.pendingBytes && !this.outstandingBytes) {
      this.stop();
      this.sink.finish();
      return;
    }
    // ACKs wake a credit-blocked stream. Poll only for socket drain or a yielded batch.
    if (
      this.timer === null &&
      (this.replayCursor < this.sent ||
        (this.outstandingBytes < OUTPUT_WINDOW &&
          this.frames.length < OUTPUT_FRAMES &&
          (this.pendingBytes ||
            (this.paused && this.sink.bufferedAmount() > OUTPUT_LOW_WATER))))
    ) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, 16);
    }
  }
}
