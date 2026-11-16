/** Theme colors a query asks for; the background carries the dark/light scheme. */
export const THEME_FOREGROUND = 1;
export const THEME_BACKGROUND = 2;
/**
 * A query whose color the cores do not agree on, so its reply may carry
 * neither the foreground nor the background.
 */
export const THEME_QUERY = 4;
/**
 * `CSI ? 996 n` replies with the scheme itself, whatever color an application
 * has pinned as its background.
 */
export const THEME_SCHEME = 8;
/**
 * The chunk sets a background with OSC 11, so a core that keeps that override
 * answers a later query with it instead of the theme background.
 */
export const THEME_BACKGROUND_SET = 16;

const ESC = 0x1b;
const BEL = 0x07;
const SEMICOLON = 0x3b;
/** Parameters of a CSI color query that can matter; `?996` is the longest. */
const CSI_HEAD = 8;
/** Characters of an OSC parameter that can matter; `?` is the only query. */
const OSC_PARAM = 2;
/** Parameters a core can still name a color from; OSC 10 through 19. */
const OSC_PARAMS = 10;

/**
 * `csi-other` is a CSI sequence that cannot be a query: only `CSI ? 996 n`
 * is, so any other first byte rules it out.
 */
type State = "ground" | "escape" | "csi" | "csi-other" | "osc";

/**
 * The theme color queries in the output, recognized the way the cores parse
 * them: OSC 10 and 11 with `?` parameters, and `CSI ? 996 n`. The scanner keeps
 * its sequence state between calls, so a query cut by a chunk boundary is
 * recognized when the rest of it arrives.
 *
 * A query is only answered with the theme background while the application has
 * not pinned one, so an OSC 11 that sets a background is reported too.
 */
export class ThemeQueryScanner {
  private _state: State = "ground";
  private _csiHead = "";
  private _csiPrivate = 0;
  private _csiIntermediate = false;
  private _csiTooLong = false;
  private _oscHead = "";
  /** OSC number while the payload can still be a color query, 0 otherwise. */
  private _oscNumber = 0;
  private _oscParam = "";
  private _oscIndex = 0;
  /**
   * Whether every parameter so far is a `?`, the only payload the built-in and
   * Ghostty cores number the same way.
   */
  private _oscNamed = true;
  private _oscColors = 0;

  /**
   * The theme colors the query sequences in `data` ask for, as a bit set.
   * Every write passes through here, so the runs that cannot change the
   * result are skipped in bulk: text and the sequences up to the next
   * `ESC ]` or `ESC [ ?`, the body of a CSI sequence that is not a query, and
   * an OSC payload past the parameters that can name a color.
   */
  scan(data: string | Uint8Array): number {
    const text = typeof data === "string";
    const n = data.length;
    let colors = 0;
    let i = 0;
    while (i < n) {
      switch (this._state) {
        case "ground": {
          // Only `ESC ]` and `ESC [ ?` can start a query, and every ESC
          // restarts the sequence, so the ones in between (mostly SGR in
          // styled output) cannot change the result. Steps resume at a
          // candidate, or at the last ESC to leave the state the write ends in.
          const esc = text ? data.indexOf("\x1b", i) : data.indexOf(ESC, i);
          if (esc < 0) return colors;
          let next = text
            ? findQueryText(data, esc)
            : findQueryBytes(data, esc);
          if (next < 0)
            next = text ? data.lastIndexOf("\x1b") : data.lastIndexOf(ESC);
          this._state = "escape";
          i = next + 1;
          continue;
        }
        case "csi-other":
          i = text ? skipCsiText(data, i) : skipCsiBytes(data, i);
          if (i < n) {
            // The final byte, or one that cancels the sequence.
            const code = text ? data.charCodeAt(i) : data[i];
            this._state = code === ESC ? "escape" : "ground";
            i++;
          }
          continue;
        case "osc":
          if (this._oscIgnoresPayload()) {
            i = text ? skipOscText(data, i) : skipOscBytes(data, i);
            if (i < n) colors |= this._osc(text ? data.charCodeAt(i) : data[i]);
            i++;
            continue;
          }
      }
      colors |= this._step(text ? data.charCodeAt(i) : data[i]);
      i++;
    }
    return colors;
  }

  private _step(byte: number): number {
    switch (this._state) {
      case "ground":
        if (byte === ESC) this._state = "escape";
        return 0;
      case "escape":
        return this._escaped(byte);
      case "csi":
        return this._csi(byte);
      case "csi-other":
        // scan() consumes this state itself.
        return 0;
      case "osc":
        return this._osc(byte);
    }
  }

  private _resetOsc(): void {
    this._oscHead = "";
    this._oscNumber = 0;
    this._oscParam = "";
    this._oscIndex = 0;
    this._oscNamed = true;
    this._oscColors = 0;
  }

  private _escaped(byte: number): number {
    switch (byte) {
      case 0x5b:
        this._state = "csi";
        this._csiHead = "";
        this._csiPrivate = 0;
        this._csiIntermediate = false;
        this._csiTooLong = false;
        return 0;
      case 0x5d:
        this._state = "osc";
        this._resetOsc();
        return 0;
      case ESC:
        return 0;
      default:
        this._state = "ground";
        return 0;
    }
  }

  private _csi(byte: number): number {
    if (byte === ESC) {
      this._state = "escape";
      return 0;
    }
    if (byte >= 0x40 && byte <= 0x7e) {
      const query =
        this._csiPrivate === 0x3f &&
        !this._csiIntermediate &&
        !this._csiTooLong &&
        this._csiHead !== "" &&
        Number(this._csiHead) === 996 &&
        byte === 0x6e;
      this._state = "ground";
      return query ? THEME_BACKGROUND | THEME_SCHEME : 0;
    }
    if (this._csiPrivate === 0) {
      // The first byte: only `CSI ? 996 n` is a query, so any other parameter
      // or intermediate byte runs to a final byte without asking for a color.
      if (byte === 0x3f) this._csiPrivate = byte;
      else this._state = byte >= 0x20 && byte <= 0x3f ? "csi-other" : "ground";
      return 0;
    }
    if (byte >= 0x20 && byte <= 0x2f) {
      this._csiIntermediate = true;
      return 0;
    }
    if (byte < 0x30 || byte > 0x3f) {
      this._state = "ground";
      return 0;
    }
    if (this._csiHead.length >= CSI_HEAD) {
      this._csiTooLong = true;
      return 0;
    }
    this._csiHead += String.fromCharCode(byte);
    return 0;
  }

  private _osc(byte: number): number {
    // Only BEL and ESC end an OSC in either core; a bare 0x9c is payload.
    if (byte === BEL) return this._finishOsc();
    if (byte === ESC) {
      // The cores dispatch the payload at the ESC that starts the terminator,
      // so a query answered then must be reported before the `\` arrives.
      const colors = this._finishOsc();
      this._state = "escape";
      return colors;
    }
    this._oscPayload(byte);
    return 0;
  }

  /** Whether the rest of the OSC payload, up to its terminator, is ignored. */
  private _oscIgnoresPayload(): boolean {
    return (
      this._oscHead.length >= 3 &&
      (this._oscNumber === 0 || this._oscIndex >= OSC_PARAMS)
    );
  }

  /** Collects the OSC number and the `?` parameters that follow it. */
  private _oscPayload(byte: number): void {
    if (this._oscHead.length < 3) {
      this._oscHead += String.fromCharCode(byte);
      const head = this._oscHead;
      if (head.length < 3 || head[0] !== "1" || head[2] !== ";") return;
      if (head[1] === "0") this._oscNumber = 10;
      else if (head[1] === "1") this._oscNumber = 11;
      return;
    }
    if (this._oscNumber === 0 || this._oscIndex >= OSC_PARAMS) return;
    if (byte === SEMICOLON) {
      this._oscParamDone();
      return;
    }
    if (this._oscParam.length < OSC_PARAM)
      this._oscParam += String.fromCharCode(byte);
  }

  /** Records one `?` parameter, which asks for the color at its number. */
  private _oscParamDone(): void {
    const param = this._oscParam;
    const number = this._oscNumber + this._oscIndex;
    this._oscIndex += 1;
    this._oscParam = "";
    if (param !== "?") {
      // A color where a `?` belongs sets the background, and a core that keeps
      // it answers the next query with that color instead of the theme's.
      // Both cores read a color as `#rrggbb` or `rgb:`/`rgba:`.
      if (number === 11 && (param[0] === "#" || param === "rg"))
        this._oscColors |= THEME_BACKGROUND_SET;
      // The cores number the parameters the same way only while every one of
      // them asks: a Ghostty core drops an empty parameter and stops at one
      // that is not a color.
      this._oscNamed = false;
      return;
    }
    if (!this._oscNamed)
      // The query still refreshes the CSS colors, but its color differs between
      // the cores, so the reply may leave the background out.
      this._oscColors |= THEME_QUERY;
    else if (number === 10) this._oscColors |= THEME_FOREGROUND;
    else if (number === 11) this._oscColors |= THEME_BACKGROUND;
    // A Ghostty core alone answers the colors past the background.
    else this._oscColors |= THEME_QUERY;
  }

  private _finishOsc(): number {
    if (this._oscNumber !== 0) this._oscParamDone();
    const colors = this._oscColors;
    this._state = "ground";
    this._oscColors = 0;
    return colors;
  }
}

/**
 * The index of the first `ESC ]` or `ESC [ ?` at or after `i`, or -1. Both
 * have `[` or `]` after the ESC, so the search reads every other byte and
 * steps one byte only onto an ESC.
 */
function findQueryBytes(data: Uint8Array, i: number): number {
  const n = data.length;
  while (i + 1 < n) {
    const next = data[i + 1];
    if (next === ESC) i++;
    else if (
      data[i] === ESC &&
      (next === 0x5d || (next === 0x5b && i + 2 < n && data[i + 2] === 0x3f))
    )
      return i;
    else i += 2;
  }
  return -1;
}

function findQueryText(data: string, i: number): number {
  const n = data.length;
  while (i + 1 < n) {
    const next = data.charCodeAt(i + 1);
    if (next === ESC) i++;
    else if (
      data.charCodeAt(i) === ESC &&
      (next === 0x5d ||
        (next === 0x5b && i + 2 < n && data.charCodeAt(i + 2) === 0x3f))
    )
      return i;
    else i += 2;
  }
  return -1;
}

/** The index of the first byte at or after `i` that ends a CSI sequence. */
function skipCsiText(data: string, i: number): number {
  const n = data.length;
  while (i < n) {
    const code = data.charCodeAt(i);
    if (code < 0x20 || code > 0x3f) break;
    i++;
  }
  return i;
}

function skipCsiBytes(data: Uint8Array, i: number): number {
  const n = data.length;
  while (i < n) {
    const code = data[i];
    if (code < 0x20 || code > 0x3f) break;
    i++;
  }
  return i;
}

/** The index of the first BEL or ESC at or after `i`, which ends an OSC. */
function skipOscText(data: string, i: number): number {
  const n = data.length;
  while (i < n) {
    const code = data.charCodeAt(i);
    if (code === BEL || code === ESC) break;
    i++;
  }
  return i;
}

function skipOscBytes(data: Uint8Array, i: number): number {
  const n = data.length;
  while (i < n) {
    const code = data[i];
    if (code === BEL || code === ESC) break;
    i++;
  }
  return i;
}
