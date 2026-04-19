import type { WTerm } from "@wterm/dom";
import { encodeStream } from "./encode.js";

export interface TerminalSnapshot {
  version: 1;
  cols: number;
  rows: number;
  payload: string;
  cursor: { row: number; col: number; visible: boolean };
  modes: {
    altScreen: boolean;
    cursorKeysApp: boolean;
    bracketedPaste: boolean;
  };
}

export function serialize(term: WTerm): TerminalSnapshot {
  if (!term.bridge) {
    throw new Error("wterm: cannot serialize before init");
  }

  const cursor = term.bridge.getCursor();

  return {
    version: 1,
    cols: term.bridge.getCols(),
    rows: term.bridge.getRows(),
    payload: encodeStream(term.bridge),
    cursor: {
      row: cursor.row,
      col: cursor.col,
      visible: cursor.visible,
    },
    modes: {
      altScreen: term.bridge.usingAltScreen(),
      cursorKeysApp: term.bridge.cursorKeysApp(),
      bracketedPaste: term.bridge.bracketedPaste(),
    },
  };
}

export function restore(term: WTerm, snapshot: TerminalSnapshot): void {
  if (!term.bridge) {
    throw new Error("wterm: cannot restore before init");
  }

  if (snapshot.version !== 1) {
    throw new Error(`wterm: unsupported snapshot version ${snapshot.version}`);
  }

  const parts: string[] = [];

  if (snapshot.modes.altScreen) parts.push("\x1b[?1049h");
  parts.push(snapshot.payload);
  if (snapshot.modes.cursorKeysApp) parts.push("\x1b[?1h");
  if (snapshot.modes.bracketedPaste) parts.push("\x1b[?2004h");

  parts.push(`\x1b[${snapshot.cursor.row + 1};${snapshot.cursor.col + 1}H`);
  parts.push(snapshot.cursor.visible ? "\x1b[?25h" : "\x1b[?25l");

  term.write(parts.join(""));
}
