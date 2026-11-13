/** Theme colors a query asks for; the background carries the dark/light scheme. */
export const THEME_FOREGROUND = 1;
export const THEME_BACKGROUND = 2;

const ESC = 0x1b;
const BEL = 0x07;
const SEMICOLON = 0x3b;
/** Parameters of a CSI color query that can matter; `?996` is the longest. */
const CSI_HEAD = 8;
/** Characters of an OSC parameter that can matter; `?` is the only query. */
const OSC_PARAM = 2;

type State = "ground" | "escape" | "csi" | "osc";

/**
 * The theme color queries in the output, recognized the way the cores parse
 * them: OSC 10 and 11 with `?` parameters, and `CSI ? 996 n`. The scanner keeps
 * its sequence state between calls, so a query cut by a chunk boundary is
 * recognized when the rest of it arrives.
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
  private _oscColors = 0;

  /** The theme colors the query sequences in `data` ask for, as a bit set. */
  scan(data: string | Uint8Array): number {
    let colors = 0;
    for (let i = 0; i < data.length; i++) {
      const byte = typeof data === "string" ? data.charCodeAt(i) : data[i];
      colors |= this._step(byte);
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
      case "osc":
        return this._osc(byte);
    }
  }

  private _resetOsc(): void {
    this._oscHead = "";
    this._oscNumber = 0;
    this._oscParam = "";
    this._oscIndex = 0;
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
      return query ? THEME_BACKGROUND : 0;
    }
    if (byte >= 0x20 && byte <= 0x2f) {
      this._csiIntermediate = true;
      return 0;
    }
    if (byte < 0x30 || byte > 0x3f) {
      this._state = "ground";
      return 0;
    }
    const first = this._csiHead === "" && this._csiPrivate === 0;
    if (
      first &&
      (byte === 0x3f || byte === 0x3c || byte === 0x3d || byte === 0x3e)
    ) {
      this._csiPrivate = byte;
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
    // The core stops asking once the next OSC number would pass 11.
    if (this._oscNumber === 0 || this._oscNumber + this._oscIndex > 11) return;
    if (byte === SEMICOLON) {
      this._oscParamDone();
      return;
    }
    if (this._oscParam.length < OSC_PARAM)
      this._oscParam += String.fromCharCode(byte);
  }

  /** Records one `?` parameter, which asks for the color at its number. */
  private _oscParamDone(): void {
    const number = this._oscNumber + this._oscIndex;
    this._oscIndex += 1;
    if (this._oscParam === "?")
      this._oscColors |=
        number === 10 ? THEME_FOREGROUND : number === 11 ? THEME_BACKGROUND : 0;
    this._oscParam = "";
  }

  private _finishOsc(): number {
    if (this._oscNumber !== 0) this._oscParamDone();
    const colors = this._oscColors;
    this._state = "ground";
    this._oscColors = 0;
    return colors;
  }
}
