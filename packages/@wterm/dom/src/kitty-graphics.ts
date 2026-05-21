/**
 * Streaming parser for the Kitty terminal graphics protocol.
 *
 * Intercepts APC sequences of the form `\x1b_G<control>;<payload>\x1b\\`
 * (or BEL-terminated `\x1b_G<control>;<payload>\x07`) from a byte stream,
 * splits the input into pass-through text and graphics events, and
 * accumulates chunked transfers (`m=1` followed by `m=0`).
 *
 * Spec: https://sw.kovidgoyal.net/kitty/graphics-protocol/
 */

export type KittyAction = "t" | "T" | "p" | "d" | "f" | "a" | "q";

export interface KittyControl {
  /** Action: t (transmit), T (transmit+display), p (put), d (delete), etc. */
  a?: string;
  /** Format: 100 = PNG, 24 = RGB, 32 = RGBA. */
  f?: number;
  /** Transport: d (direct base64, default), f (file), t (temp file), s (shared mem). */
  t?: string;
  /** Image id. */
  i?: number;
  /** Image number. */
  I?: number;
  /** More chunks follow (1) or last chunk (0). */
  m?: number;
  /** Quiet mode. */
  q?: number;
  /** Source pixel width (for raw formats). */
  s?: number;
  /** Source pixel height (for raw formats). */
  v?: number;
  /** Columns to fit. */
  c?: number;
  /** Rows to fit. */
  r?: number;
  /** Placement id. */
  p?: number;
  /** Z-index. */
  z?: number;
  /** Source rect: x, y offset. */
  x?: number;
  y?: number;
  /** Source rect: width, height. */
  w?: number;
  h?: number;
  /** Cell offset for placement. */
  X?: number;
  Y?: number;
  /** Cursor-movement policy (0 default = move, 1 = don't move). */
  C?: number;
  /** Delete specifier: `a` (all), `i` (by id), etc. */
  d?: string;
  /** Catch-all for additional keys. */
  [key: string]: number | string | undefined;
}

export interface KittyGraphicsEvent {
  control: KittyControl;
  /** Raw decoded payload bytes. Empty for control-only commands like delete. */
  data: Uint8Array;
}

export type StreamEvent =
  | { type: "text"; bytes: Uint8Array }
  | { type: "graphics"; event: KittyGraphicsEvent };

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;
const UNDERSCORE = 0x5f;
const G = 0x47;

const enum State {
  Idle = 0,
  EscSeen = 1,
  UnderscoreSeen = 2,
  InKittyApc = 3,
  InKittyApcEsc = 4,
}

interface PendingChunk {
  control: KittyControl;
  /** Concatenated base64 payload across chunks. */
  payload: string;
}

/** Maximum number of simultaneously-buffered chunked transfers. */
export const MAX_PENDING_CHUNKS = 8;
/** Maximum total base64 bytes held across all in-flight chunked transfers. */
export const MAX_PENDING_BASE64_BYTES = 32 * 1024 * 1024;

/**
 * Stateful streaming filter. Feed it raw bytes via {@link push}, receive
 * an ordered list of pass-through and graphics events.
 */
export class KittyGraphicsFilter {
  private state: State = State.Idle;
  /** Buffered Kitty APC payload (bytes between `\x1b_G` and the terminator). */
  private apcBuf: number[] = [];
  /** Pending chunked transfers keyed by image id (i=) or image number (-I=). */
  private pendingChunks = new Map<string, PendingChunk>();
  /** Running total of buffered base64 bytes across all pending chunks. */
  private pendingBytes = 0;

  /**
   * Push a chunk of bytes through the filter. Returns the ordered list of
   * pass-through text segments and completed graphics events.
   */
  push(input: Uint8Array): StreamEvent[] {
    const events: StreamEvent[] = [];
    let textStart = -1;

    const flushText = (endExclusive: number): void => {
      if (textStart >= 0 && endExclusive > textStart) {
        events.push({
          type: "text",
          bytes: input.slice(textStart, endExclusive),
        });
      }
      textStart = -1;
    };

    const startText = (idx: number): void => {
      if (textStart < 0) textStart = idx;
    };

    const emitBytesLiteral = (bytes: number[]): void => {
      if (bytes.length === 0) return;
      events.push({ type: "text", bytes: new Uint8Array(bytes) });
    };

    for (let i = 0; i < input.length; i++) {
      const b = input[i];

      switch (this.state) {
        case State.Idle:
          if (b === ESC) {
            flushText(i);
            this.state = State.EscSeen;
          } else {
            startText(i);
          }
          break;

        case State.EscSeen:
          if (b === UNDERSCORE) {
            this.state = State.UnderscoreSeen;
          } else if (b === ESC) {
            emitBytesLiteral([ESC]);
            // stay in EscSeen with the new ESC
          } else {
            emitBytesLiteral([ESC, b]);
            this.state = State.Idle;
          }
          break;

        case State.UnderscoreSeen:
          if (b === G) {
            this.state = State.InKittyApc;
            this.apcBuf = [];
          } else if (b === ESC) {
            // \x1b_<ESC...> — flush ESC + _ to output, reprocess ESC
            emitBytesLiteral([ESC, UNDERSCORE]);
            this.state = State.EscSeen;
          } else {
            emitBytesLiteral([ESC, UNDERSCORE, b]);
            this.state = State.Idle;
          }
          break;

        case State.InKittyApc:
          if (b === ESC) {
            this.state = State.InKittyApcEsc;
          } else if (b === BEL) {
            this._completeApc(events);
            this.state = State.Idle;
          } else {
            this.apcBuf.push(b);
          }
          break;

        case State.InKittyApcEsc:
          if (b === BACKSLASH) {
            this._completeApc(events);
            this.state = State.Idle;
          } else {
            // Not ST; treat the ESC as part of the payload and reprocess `b`.
            this.apcBuf.push(ESC);
            this.state = State.InKittyApc;
            i--;
          }
          break;
      }
    }

    flushText(input.length);
    return coalesce(events);
  }

  /**
   * Discard any partially-accumulated state. Call when the upstream stream
   * is reset (e.g. core re-init) so a half-buffered APC doesn't leak into
   * the next session.
   */
  reset(): void {
    this.state = State.Idle;
    this.apcBuf = [];
    this.pendingChunks.clear();
    this.pendingBytes = 0;
  }

  private _completeApc(events: StreamEvent[]): void {
    const buf = this.apcBuf;
    this.apcBuf = [];

    const semi = buf.indexOf(0x3b);
    let ctrlBytes: number[];
    let payloadBytes: number[];
    if (semi < 0) {
      ctrlBytes = buf;
      payloadBytes = [];
    } else {
      ctrlBytes = buf.slice(0, semi);
      payloadBytes = buf.slice(semi + 1);
    }

    const control = parseControl(decodeAscii(ctrlBytes));
    const payloadB64 = decodeAscii(payloadBytes);

    const more = control.m === 1;
    const key = chunkKey(control);

    if (more || this.pendingChunks.has(key)) {
      const existing = this.pendingChunks.get(key);
      if (existing) {
        if (this.pendingBytes + payloadB64.length > MAX_PENDING_BASE64_BYTES) {
          this.pendingBytes -= existing.payload.length;
          this.pendingChunks.delete(key);
          return;
        }
        existing.payload += payloadB64;
        this.pendingBytes += payloadB64.length;
        // Merge controls — later chunks may omit fields. Keep first-chunk
        // values, but `m` reflects the latest.
        existing.control.m = control.m;
      } else {
        if (payloadB64.length > MAX_PENDING_BASE64_BYTES) {
          return;
        }
        if (this.pendingChunks.size >= MAX_PENDING_CHUNKS) {
          const oldestKey = this.pendingChunks.keys().next().value;
          if (oldestKey !== undefined) {
            const oldest = this.pendingChunks.get(oldestKey);
            if (oldest) this.pendingBytes -= oldest.payload.length;
            this.pendingChunks.delete(oldestKey);
          }
        }
        this.pendingChunks.set(key, {
          control: { ...control },
          payload: payloadB64,
        });
        this.pendingBytes += payloadB64.length;
      }

      if (more) return;

      const completed = this.pendingChunks.get(key);
      this.pendingChunks.delete(key);
      if (!completed) return;
      this.pendingBytes -= completed.payload.length;
      let data: Uint8Array;
      try {
        data = decodeBase64(completed.payload);
      } catch {
        return;
      }
      events.push({
        type: "graphics",
        event: {
          control: completed.control,
          data,
        },
      });
      return;
    }

    let data: Uint8Array;
    try {
      data = decodeBase64(payloadB64);
    } catch {
      return;
    }
    events.push({
      type: "graphics",
      event: {
        control,
        data,
      },
    });
  }
}

/** Merge adjacent text events into a single chunk so callers see one writeRaw per contiguous run. */
function coalesce(events: StreamEvent[]): StreamEvent[] {
  if (events.length < 2) return events;
  const out: StreamEvent[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (ev.type === "text" && last && last.type === "text") {
      const merged = new Uint8Array(last.bytes.length + ev.bytes.length);
      merged.set(last.bytes, 0);
      merged.set(ev.bytes, last.bytes.length);
      out[out.length - 1] = { type: "text", bytes: merged };
    } else {
      out.push(ev);
    }
  }
  return out;
}

function chunkKey(control: KittyControl): string {
  if (typeof control.i === "number") return `i:${control.i}`;
  if (typeof control.I === "number") return `I:${control.I}`;
  return "default";
}

const LATIN1 = new TextDecoder("latin1");

function decodeAscii(bytes: number[]): string {
  return LATIN1.decode(new Uint8Array(bytes));
}

function parseControl(s: string): KittyControl {
  const out: KittyControl = {};
  if (!s) return out;
  for (const part of s.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!key) continue;
    const asNum = Number(val);
    if (val !== "" && !Number.isNaN(asNum) && /^-?\d+$/.test(val)) {
      out[key] = asNum;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function decodeBase64(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
