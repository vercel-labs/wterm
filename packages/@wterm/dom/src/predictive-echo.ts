import type { WTerm } from "./wterm.js";

/**
 * Options for {@link PredictiveEcho}.
 */
export interface PredictiveEchoOptions {
  /** Terminal instance whose output buffer we predict against. */
  term: WTerm;
  /** Called when user input should be forwarded to the backend (e.g. PTY). */
  send: (data: string) => void;
  /**
   * Optional override: return `true` if `data` should be predicted locally.
   * Defaults to: a single printable ASCII character, and not while the
   * terminal is in alt-screen mode.
   */
  shouldPredict?: (data: string, term: WTerm) => boolean;
}

/**
 * Mosh-style client-side echo prediction for `WTerm`.
 *
 * Use this when there is observable latency between the user pressing a key
 * and the backend (PTY, SSH stream, ...) echoing it back. `PredictiveEcho`
 * paints the character to the local terminal at typing latency, then
 * reconciles with the authoritative server output as it arrives.
 *
 * - Predicted characters are queued; when the server later sends matching
 *   bytes back, they are consumed from the queue and *not* written again,
 *   avoiding duplicates.
 * - Any server byte that doesn't match the expected prediction (e.g. an
 *   escape sequence or a mid-prompt redraw) rolls back the entire queue
 *   with `\x1b[ND\x1b[NX` and lets the server stream take over — the
 *   ghostty / wterm core remains the source of truth.
 * - By default predictions are disabled in alt-screen mode (vim, less,
 *   htop, ...) so full-screen applications render exactly as the server
 *   sent them.
 *
 * @example
 * ```ts
 * import { WTerm, WebSocketTransport, PredictiveEcho } from "@wterm/dom";
 *
 * const term = new WTerm(el);
 * const transport = new WebSocketTransport({ url: "wss://..." });
 *
 * const echo = new PredictiveEcho({
 *   term,
 *   send: (data) => transport.send(data),
 * });
 *
 * term.onData = (data) => echo.handleInput(data);
 * transport.onData = (data) => echo.handleServerData(data);
 *
 * await term.init();
 * transport.connect();
 * ```
 */
export class PredictiveEcho {
  private term: WTerm;
  private send: (data: string) => void;
  private shouldPredictFn: (data: string, term: WTerm) => boolean;
  private queue = "";

  constructor(options: PredictiveEchoOptions) {
    this.term = options.term;
    this.send = options.send;
    this.shouldPredictFn = options.shouldPredict ?? defaultShouldPredict;
  }

  /**
   * Call this from `WTerm.onData` (or wherever user input originates). The
   * data is forwarded via the configured `send` callback. If it's a
   * predictable character we also paint it to the terminal immediately and
   * remember it for reconciliation.
   */
  handleInput(data: string): void {
    this.send(data);
    if (this.shouldPredictFn(data, this.term)) {
      this.queue += data;
      this.term.write(data);
    } else if (this.queue.length > 0) {
      this.rollback();
    }
  }

  /**
   * Call this with every chunk of server output before passing it to the
   * terminal. Bytes that match the head of the prediction queue are
   * silently consumed; everything else is written normally, after rolling
   * back any unmatched predictions.
   */
  handleServerData(data: Uint8Array | string): void {
    if (this.queue.length === 0) {
      this.term.write(data);
      return;
    }

    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;

    let offset = 0;
    while (
      offset < bytes.length &&
      this.queue.length > 0 &&
      bytes[offset] === this.queue.charCodeAt(0)
    ) {
      this.queue = this.queue.slice(1);
      offset++;
    }

    if (offset < bytes.length) {
      if (this.queue.length > 0) this.rollback();
      this.term.write(bytes.slice(offset));
    }
  }

  /** Drop the prediction queue without rolling back DOM state. */
  reset(): void {
    this.queue = "";
  }

  /**
   * Cursor back N + erase character N to wipe the predicted glyphs from
   * the terminal so the server output that triggered the rollback lands
   * on a clean canvas.
   */
  private rollback(): void {
    const n = this.queue.length;
    if (n === 0) return;
    this.term.write(`\x1b[${n}D\x1b[${n}X`);
    this.queue = "";
  }
}

function defaultShouldPredict(data: string, term: WTerm): boolean {
  if (term.bridge?.usingAltScreen()) return false;
  if (data.length !== 1) return false;
  const code = data.charCodeAt(0);
  return code >= 0x20 && code <= 0x7e;
}
