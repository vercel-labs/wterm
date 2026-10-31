import type { TerminalCore } from "@wterm/core";

const MAX_TEXT_LENGTH = 16 * 1024 * 1024;

/** Copy cell text in small batches without mounting retained history. */
export function* scanText(
  core: TerminalCore,
  limit = MAX_TEXT_LENGTH,
): Generator<void, string> {
  const history = core.getScrollbackCount();
  const parts: string[] = [];
  let chunk = "";
  let length = 0;
  let work = 0;
  let previousWrap = false;
  const append = (text: string) => {
    length += text.length;
    if (length > limit)
      throw new RangeError(
        "Terminal text exceeds 16,777,216 UTF-16 code units",
      );
    chunk += text;
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  };
  for (let row = 0; row < history + core.getRows(); row++) {
    const offset = history - row - 1;
    const metadata =
      row < history
        ? core.getScrollbackRowMetadata?.(offset)
        : core.getRowMetadata?.(row - history);
    if (row > 0 && !(previousWrap && metadata?.continuesPrevious)) append("\n");
    previousWrap = metadata?.wrapsToNext ?? false;
    const cols =
      row < history ? core.getScrollbackLineLen(offset) : core.getCols();
    // Hold ASCII spaces until the row ends, so hard-line padding is omitted.
    let spaces = 0;
    for (let col = 0; col < cols; col++) {
      if (++work >= 256) {
        work = 0;
        yield;
      }
      const cell =
        row < history
          ? core.getScrollbackCell(offset, col)
          : core.getCell(row - history, col);
      if (cell.width === 0 || cell.spacerHead) continue;
      const text = cell.chars ?? String.fromCodePoint(cell.char || 32);
      if (/^ +$/.test(text)) {
        spaces += text.length;
      } else {
        if (length + spaces + text.length > limit)
          throw new RangeError(
            "Terminal text exceeds 16,777,216 UTF-16 code units",
          );
        append(" ".repeat(spaces) + text);
        spaces = 0;
      }
    }
    if (previousWrap) {
      if (length + spaces > limit)
        throw new RangeError(
          "Terminal text exceeds 16,777,216 UTF-16 code units",
        );
      append(" ".repeat(spaces));
    }
    if (++work >= 256) {
      work = 0;
      yield;
    }
  }
  parts.push(chunk);
  return parts.join("");
}

function aborted(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

/** One cancellable capture, resumed only after WTerm paints its current state. */
export class TextCapture {
  private request: {
    resolve: (text: string) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    abort: () => void;
    scan: Generator<void, string> | null;
  } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  read(signal?: AbortSignal): Promise<string> {
    this.cancel(aborted("Replaced by another text capture"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel(signal?.reason);
      this.request = { resolve, reject, signal, abort, scan: null };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  resume(core: TerminalCore): void {
    const request = this.request;
    if (!request || request.scan) return;
    const scan = (request.scan = scanText(core));
    const tick = () => {
      if (this.request !== request) return;
      this.timer = null;
      const deadline = performance.now() + 4;
      try {
        for (let batch = 0; batch < 32; batch++) {
          const next = scan.next();
          if (next.done) {
            this.release();
            request.resolve(next.value);
            return;
          }
          if (performance.now() >= deadline) break;
        }
        this.timer = setTimeout(tick, 0);
      } catch (error) {
        this.cancel(error);
      }
    };
    this.timer = setTimeout(tick, 0);
  }

  cancel(error?: unknown): void {
    const request = this.request;
    if (!request) return;
    this.release();
    request.reject(
      error === undefined
        ? aborted("Terminal changed during text capture")
        : error,
    );
  }

  private release(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.request?.signal?.removeEventListener("abort", this.request.abort);
    this.request?.scan?.return("");
    this.request = null;
  }
}
