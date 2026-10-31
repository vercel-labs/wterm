/** Collect adjacent PTY reads without allocating an unbounded socket message. */
export class PtyOutputQueue {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private maxBytes: number;
  private maxChunks: number;
  private chunkBytes: number;
  private ready: () => void;

  constructor(
    maxBytes: number,
    maxChunks: number,
    chunkBytes: number,
    ready: () => void,
  ) {
    this.maxBytes = maxBytes;
    this.maxChunks = maxChunks;
    this.chunkBytes = chunkBytes;
    this.ready = ready;
  }

  get pendingBytes(): number {
    return this.bytes;
  }

  get batching(): boolean {
    return this.timer !== null;
  }

  push(text: string | Uint8Array): boolean {
    const bytes =
      typeof text === "string" ? Buffer.byteLength(text) : text.byteLength;
    if (
      bytes > this.maxBytes - this.bytes ||
      this.chunks.length + Math.ceil(bytes / this.chunkBytes) > this.maxChunks
    )
      return false;
    const data = typeof text === "string" ? Buffer.from(text, "utf8") : text;
    // Own the bytes; a partially consumed read retains at most one chunk's
    // allocation, even when the caller supplied a much larger buffer.
    for (let i = 0; i < data.length; i += this.chunkBytes)
      this.chunks.push(Uint8Array.from(data.subarray(i, i + this.chunkBytes)));
    this.bytes += bytes;
    return true;
  }

  schedule(): void {
    if (this.bytes >= this.chunkBytes) {
      this.cancel();
      this.ready();
    } else if (this.bytes && this.timer === null) {
      // Do not restart this deadline on another read or an acknowledgment.
      this.timer = setTimeout(() => {
        this.timer = null;
        this.ready();
      }, 4);
    }
  }

  /** A copied frame; retain the queue until the send succeeds. */
  peek(capacity: number): Uint8Array {
    const result = new Uint8Array(
      Math.min(capacity, this.chunkBytes, this.bytes),
    );
    let offset = 0;
    for (const chunk of this.chunks) {
      const size = Math.min(chunk.length, result.length - offset);
      result.set(chunk.subarray(0, size), offset);
      offset += size;
      if (offset === result.length) break;
    }
    return result;
  }

  consume(bytes: number): void {
    this.bytes -= bytes;
    while (bytes) {
      const head = this.chunks[0];
      if (bytes < head.length) {
        this.chunks[0] = head.subarray(bytes);
        break;
      }
      bytes -= head.length;
      this.chunks.shift();
    }
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  clear(): void {
    this.cancel();
    this.chunks = [];
    this.bytes = 0;
  }
}
