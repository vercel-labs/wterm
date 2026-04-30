import type { TerminalCore, CellData } from "@wterm/core";

const FLAG_NAMES: Record<number, string> = {
  0x01: "bold",
  0x02: "dim",
  0x04: "italic",
  0x08: "underline",
  0x10: "blink",
  0x20: "reverse",
  0x40: "invisible",
  0x80: "strikethrough",
};

function flagsToNames(flags: number): string[] {
  const names: string[] = [];
  for (const [bit, name] of Object.entries(FLAG_NAMES)) {
    if (flags & Number(bit)) names.push(name);
  }
  return names;
}

// -- Escape-sequence scanner (lightweight, no terminal emulation) --

export interface TraceEntry {
  ts: number;
  type: "csi" | "sgr" | "osc" | "esc" | "text";
  raw: string;
  params?: number[];
  private?: string;
  final?: string;
}

const ESC = 0x1b;

function scanSequences(data: string): TraceEntry[] {
  const entries: TraceEntry[] = [];
  const ts = Date.now();
  let i = 0;
  let textStart = 0;

  const flushText = () => {
    if (i > textStart) {
      const raw = data.slice(textStart, i);
      if (raw.length > 0 && !/^[\x00-\x1f]+$/.test(raw)) {
        entries.push({ ts, type: "text", raw: raw.slice(0, 60) });
      }
    }
  };

  while (i < data.length) {
    if (data.charCodeAt(i) !== ESC) {
      i++;
      continue;
    }

    flushText();
    const seqStart = i;
    i++; // skip ESC

    if (i >= data.length) break;
    const next = data[i];

    if (next === "[") {
      // CSI sequence
      i++;
      let priv = "";
      if (
        i < data.length &&
        (data[i] === "?" || data[i] === ">" || data[i] === "!")
      ) {
        priv = data[i];
        i++;
      }
      let paramStr = "";
      while (
        i < data.length &&
        ((data.charCodeAt(i) >= 0x30 && data.charCodeAt(i) <= 0x3b) ||
          data[i] === ":")
      ) {
        paramStr += data[i];
        i++;
      }
      // skip intermediates
      while (
        i < data.length &&
        data.charCodeAt(i) >= 0x20 &&
        data.charCodeAt(i) <= 0x2f
      ) {
        i++;
      }
      let final = "";
      if (
        i < data.length &&
        data.charCodeAt(i) >= 0x40 &&
        data.charCodeAt(i) <= 0x7e
      ) {
        final = data[i];
        i++;
      }
      const raw = data.slice(seqStart, i);
      const params = paramStr
        ? paramStr
            .split(/[;:]/)
            .map(Number)
            .filter((n) => !isNaN(n))
        : [];

      const type = final === "m" ? "sgr" : "csi";
      entries.push({
        ts,
        type,
        raw,
        params: params.length > 0 ? params : undefined,
        private: priv || undefined,
        final,
      });
    } else if (next === "]") {
      // OSC sequence
      i++;
      while (
        i < data.length &&
        data.charCodeAt(i) !== 0x07 &&
        !(
          data.charCodeAt(i) === ESC &&
          i + 1 < data.length &&
          data[i + 1] === "\\"
        )
      ) {
        i++;
      }
      if (i < data.length) {
        if (data.charCodeAt(i) === 0x07) i++;
        else if (data.charCodeAt(i) === ESC) i += 2; // ESC backslash
      }
      const raw = data.slice(seqStart, i);
      entries.push({ ts, type: "osc", raw: raw.slice(0, 80) });
    } else if (next >= " " && next <= "~") {
      // Simple ESC + char
      i++;
      entries.push({
        ts,
        type: "esc",
        raw: data.slice(seqStart, i),
        final: next,
      });
    } else {
      i++;
    }
    textStart = i;
  }

  flushText();
  return entries;
}

// -- Cell inspector helpers --

export interface CellInfo extends CellData {
  charStr: string;
  flagNames: string[];
}

export interface GridSummary {
  rows: number;
  cols: number;
  cursor: { row: number; col: number; visible: boolean };
  altScreen: boolean;
  scrollbackCount: number;
}

// -- Perf stats --

export interface PerfStats {
  frameCount: number;
  totalRenderMs: number;
  avgRenderMs: number;
  maxRenderMs: number;
  lastDirtyRows: number;
}

// -- Unhandled sequence entry from WASM --

export interface UnhandledEntry {
  final: string;
  private: string;
  paramCount: number;
  params: number[];
}

// -- Main debug adapter --

const MAX_TRACES = 500;

export class DebugAdapter {
  private _traces: TraceEntry[] = [];
  private _bridge: TerminalCore | null = null;
  private _perf: PerfStats = {
    frameCount: 0,
    totalRenderMs: 0,
    avgRenderMs: 0,
    maxRenderMs: 0,
    lastDirtyRows: 0,
  };

  get traces(): readonly TraceEntry[] {
    return this._traces;
  }

  get perf(): Readonly<PerfStats> {
    return this._perf;
  }

  setBridge(bridge: TerminalCore): void {
    this._bridge = bridge;
  }

  traceWrite(data: string | Uint8Array): void {
    const str =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    const entries = scanSequences(str);
    for (const entry of entries) {
      this._traces.push(entry);
    }
    if (this._traces.length > MAX_TRACES) {
      this._traces = this._traces.slice(-MAX_TRACES);
    }
  }

  recordRender(renderMs: number, dirtyRows: number): void {
    this._perf.frameCount++;
    this._perf.totalRenderMs += renderMs;
    this._perf.avgRenderMs = this._perf.totalRenderMs / this._perf.frameCount;
    if (renderMs > this._perf.maxRenderMs) {
      this._perf.maxRenderMs = renderMs;
    }
    this._perf.lastDirtyRows = dirtyRows;
  }

  resetPerf(): void {
    this._perf = {
      frameCount: 0,
      totalRenderMs: 0,
      avgRenderMs: 0,
      maxRenderMs: 0,
      lastDirtyRows: 0,
    };
  }

  // -- Cell inspector --

  cell(row: number, col: number): CellInfo | null {
    if (!this._bridge) return null;
    const c = this._bridge.getCell(row, col);
    return {
      ...c,
      charStr: c.char >= 32 ? String.fromCodePoint(c.char) : "",
      flagNames: flagsToNames(c.flags),
    };
  }

  row(row: number): CellInfo[] | null {
    if (!this._bridge) return null;
    const cols = this._bridge.getCols();
    const cells: CellInfo[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(this.cell(row, c)!);
    }
    return cells;
  }

  grid(): GridSummary | null {
    if (!this._bridge) return null;
    const cursor = this._bridge.getCursor();
    return {
      rows: this._bridge.getRows(),
      cols: this._bridge.getCols(),
      cursor,
      altScreen: this._bridge.usingAltScreen(),
      scrollbackCount: this._bridge.getScrollbackCount(),
    };
  }

  unhandled(): UnhandledEntry[] {
    if (!this._bridge) return [];
    return this._bridge.getUnhandledSequences();
  }

  // -- Console-friendly dump --

  dump(count = 50): void {
    const entries = this._traces.slice(-count);
    console.group(
      `%cwterm debug — last ${entries.length} traces`,
      "color: #569cd6; font-weight: bold",
    );
    for (const e of entries) {
      const badge =
        e.type === "sgr"
          ? "%cSGR"
          : e.type === "csi"
            ? "%cCSI"
            : e.type === "osc"
              ? "%cOSC"
              : e.type === "esc"
                ? "%cESC"
                : "%cTXT";
      const color =
        e.type === "sgr"
          ? "background:#2d5a27;color:#fff;padding:1px 4px;border-radius:2px"
          : e.type === "csi"
            ? "background:#1e4a7a;color:#fff;padding:1px 4px;border-radius:2px"
            : "background:#555;color:#fff;padding:1px 4px;border-radius:2px";
      const detail = [
        e.private ? `private=${e.private}` : "",
        e.params ? `params=[${e.params}]` : "",
        e.final ? `final=${e.final}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      console.log(
        `${badge} ${e.raw.slice(0, 40)}`,
        color,
        detail ? `  ${detail}` : "",
      );
    }
    console.groupEnd();
  }

  dumpUnhandled(): void {
    const entries = this.unhandled();
    if (entries.length === 0) {
      console.log("%cwterm debug — no unhandled sequences", "color: #6a9955");
      return;
    }
    console.group(
      `%cwterm debug — ${entries.length} unhandled sequences`,
      "color: #d7ba7d; font-weight: bold",
    );
    for (const e of entries) {
      console.log(
        `  final=${e.final} private=${e.private || "-"} params=[${e.params.slice(0, e.paramCount)}]`,
      );
    }
    console.groupEnd();
  }
}
