/** Theme colors a query asks for; the background carries the dark/light scheme. */
export const THEME_FOREGROUND = 1;
export const THEME_BACKGROUND = 2;

const ESC = 0x1b;
const BEL = 0x07;
const ST = 0x9c;
const BACKSLASH = 0x5c;
/** Payload of an OSC color query that can matter; `10;?;?` is the longest. */
const OSC_HEAD = 6;
/** Parameters of a CSI color query that can matter; `?996` is the longest. */
const CSI_HEAD = 8;

type State = "ground" | "escape" | "csi" | "osc" | "oscEscape";

/**
 * The theme color queries in the output, recognized the way the cores parse
 * them: OSC 10 and 11 with `?` parameters, and `CSI ? 996 n`. The scanner keeps
 * its sequence state between calls, so a query cut by a chunk boundary is
 * recognized when the rest of it arrives.
 */
export class ThemeQueryScanner {
  private _state: State = "ground";
  private _head = "";
  private _private = 0;
  private _intermediate = false;
  private _tooLong = false;

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
      case "oscEscape":
        // ESC followed by anything but `\` aborts the payload, as in the cores.
        if (byte === BACKSLASH) return this._finishOsc();
        this._state = "ground";
        return this._escaped(byte);
    }
  }

  private _escaped(byte: number): number {
    switch (byte) {
      case 0x5b: {
        this._state = "csi";
        this._head = "";
        this._private = 0;
        this._intermediate = false;
        this._tooLong = false;
        return 0;
      }
      case 0x5d:
        this._state = "osc";
        this._head = "";
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
        this._private === 0x3f &&
        !this._intermediate &&
        !this._tooLong &&
        this._head !== "" &&
        Number(this._head) === 996 &&
        byte === 0x6e;
      this._state = "ground";
      return query ? THEME_BACKGROUND : 0;
    }
    if (byte >= 0x20 && byte <= 0x2f) {
      this._intermediate = true;
      return 0;
    }
    if (byte < 0x30 || byte > 0x3f) {
      this._state = "ground";
      return 0;
    }
    const first = this._head === "" && this._private === 0;
    if (
      first &&
      (byte === 0x3f || byte === 0x3c || byte === 0x3d || byte === 0x3e)
    ) {
      this._private = byte;
      return 0;
    }
    if (this._head.length >= CSI_HEAD) {
      this._tooLong = true;
      return 0;
    }
    this._head += String.fromCharCode(byte);
    return 0;
  }

  private _osc(byte: number): number {
    if (byte === BEL || byte === ST) return this._finishOsc();
    if (byte === ESC) {
      this._state = "oscEscape";
      return 0;
    }
    if (this._head.length < OSC_HEAD) this._head += String.fromCharCode(byte);
    return 0;
  }

  private _finishOsc(): number {
    const colors = this._oscColors();
    this._state = "ground";
    this._head = "";
    return colors;
  }

  private _oscColors(): number {
    const head = this._head;
    if (head.length < 3 || head[0] !== "1" || head[2] !== ";") return 0;
    if (head[1] === "0") return THEME_FOREGROUND;
    if (head[1] === "1") return THEME_BACKGROUND;
    return 0;
  }
}
