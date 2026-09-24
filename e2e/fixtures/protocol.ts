import { Buffer } from "node:buffer";
import type { Checkpoint, ReplayEvent, ReplayFixture } from "./types";

const output = (text: string): ReplayEvent => ({
  atMs: 0,
  type: "output",
  data: Buffer.from(text).toString("base64"),
});
const checkpoint = (name: string, expected: Checkpoint): ReplayEvent => ({
  atMs: 0,
  type: "checkpoint",
  name,
  expected,
});
const resize = (cols: number, rows: number): ReplayEvent => ({
  atMs: 0,
  type: "resize",
  cols,
  rows,
});

// Expectations are authored from the protocol operations, never generated
// from wterm's current output. Every output is delivered one byte at a time.
export const protocolFixtures: ReplayFixture[] = [
  {
    schemaVersion: 1,
    id: "wide-character-editing",
    cols: 8,
    rows: 4,
    source: { kind: "protocol" },
    events: [
      output("A界BC\x1b[1;3H\x1b[P\x1b[2;1HA界語BC\x1b[2;3H\x1b[2P"),
      checkpoint("delete exact columns through wide pairs", {
        rows: { 0: "A BC", 1: "A  BC" },
        cursor: { row: 1, col: 2 },
        cells: [
          { row: 0, col: 1, value: { char: 32, width: 1 } },
          { row: 0, col: 2, value: { char: 66, width: 1 } },
          { row: 1, col: 2, value: { char: 32, width: 1 } },
          { row: 1, col: 3, value: { char: 66, width: 1 } },
        ],
      }),
      output("\x1b[3;1HA界語BC\x1b[3;3H\x1b[@"),
      checkpoint("insert at a continuation cell", {
        rows: { 2: "A   語BC" },
        cursor: { row: 2, col: 2 },
        cells: [
          { row: 2, col: 1, value: { char: 32, width: 1 } },
          { row: 2, col: 3, value: { char: 32, width: 1 } },
          { row: 2, col: 4, value: { char: 35486, width: 2 } },
          { row: 2, col: 5, value: { width: 0 } },
          { row: 2, col: 6, value: { char: 66, width: 1 } },
        ],
      }),
      output("\x1b[4;1HABCDE界F\x1b[4;2H\x1b[2@"),
      checkpoint("blank a wide character cut off by insertion", {
        rows: { 3: "A  BCDE" },
        cells: [{ row: 3, col: 7, value: { char: 32, width: 1 } }],
      }),
      output("\x1b[3;6H\x1b[65535P\x1b[4;3H\x1b[65535@"),
      checkpoint("clamp oversized edits to the remaining columns", {
        rows: { 2: "A", 3: "A" },
        cells: [{ row: 2, col: 4, value: { char: 32, width: 1 } }],
      }),
      output("\x1b[H123456界\x1b[?7l語"),
      checkpoint("ignore a wide character that cannot fit without wrapping", {
        rows: { 0: "123456界", 1: "A  BC" },
        cursor: { row: 0, col: 7 },
        cells: [
          { row: 0, col: 6, value: { char: 30028, width: 2 } },
          { row: 0, col: 7, value: { width: 0 } },
        ],
      }),
      output("X\x1b[?7hY"),
      checkpoint("resume pending wrap when wrapping is enabled again", {
        rows: { 0: "123456 X", 1: "Y  BC" },
        cursor: { row: 1, col: 1 },
      }),
      output("\x1b[2J\x1b[H"),
      resize(1, 4),
      output("界B"),
      checkpoint("consume a wide character as a space in one column", {
        rows: { 0: "", 1: "B" },
        cursor: { row: 1, col: 0 },
        cells: [{ row: 0, col: 0, value: { char: 32, width: 1 } }],
      }),
    ],
  },
  {
    schemaVersion: 1,
    id: "unicode-and-screen-modes",
    cols: 32,
    rows: 8,
    source: { kind: "protocol" },
    events: [
      output("\x1b[1;38;5;196mA界é🙂Z\x1b[0m\r\nprimary\x1b[6n"),
      checkpoint("fragmented UTF-8 and SGR", {
        rows: { 0: "A界é🙂Z", 1: "primary" },
        cursor: { row: 1, col: 7, visible: true },
        cells: [
          { row: 0, col: 0, value: { char: 65, flags: 1, width: 1 } },
          { row: 0, col: 1, value: { char: 30028, width: 2 } },
          { row: 0, col: 2, value: { width: 0 } },
          { row: 0, col: 3, value: { char: 233, width: 1 } },
          { row: 0, col: 4, value: { char: 128578, width: 2 } },
          { row: 0, col: 5, value: { width: 0 } },
          { row: 0, col: 6, value: { char: 90, width: 1 } },
        ],
        responses: ["\x1b[2;8R"],
        styles: [
          { row: 0, text: "A", color: "rgb(255, 0, 0)", fontWeight: "700" },
        ],
      }),
      output("\x1b[?1049h\x1b[?2004h\x1b[?1h\x1b[2J\x1b[Halternate"),
      checkpoint("alternate screen", {
        rows: { 0: "alternate", 1: "" },
        modes: {
          alternateScreen: true,
          bracketedPaste: true,
          cursorKeysApp: true,
        },
      }),
      output("\x1b[?2004l\x1b[?1l\x1b[?1049l"),
      checkpoint("primary screen restored", {
        rows: { 0: "A界é🙂Z", 1: "primary" },
        cursor: { row: 1, col: 7 },
        modes: {
          alternateScreen: false,
          bracketedPaste: false,
          cursorKeysApp: false,
        },
      }),
    ],
  },
  {
    schemaVersion: 1,
    id: "resize-and-history",
    cols: 32,
    rows: 8,
    source: { kind: "protocol" },
    events: [
      output(Array.from({ length: 10 }, (_, i) => `line ${i}\r\n`).join("")),
      checkpoint("scrollback", {
        rows: { 0: "line 3", 6: "line 9", 7: "" },
        scrollbackCount: 3,
        history: ["line 0", "line 1", "line 2"],
      }),
      resize(48, 8),
      checkpoint("wider viewport", {
        cols: 48,
        height: 8,
        rows: { 0: "line 3", 6: "line 9" },
        scrollbackCount: 3,
      }),
      resize(20, 8),
      output("\x1b[2J\x1b[Hnarrow: 界\x1b[8;1Hbottom"),
      checkpoint("narrow redraw", {
        cols: 20,
        height: 8,
        rows: { 0: "narrow: 界", 7: "bottom" },
        cursor: { row: 7, col: 6 },
      }),
      resize(32, 8),
      output("\x1b[2J\x1b[Hwide again"),
      checkpoint("wide redraw", {
        cols: 32,
        height: 8,
        rows: { 0: "wide again", 7: "" },
        cursor: { row: 0, col: 10 },
      }),
    ],
  },
  {
    schemaVersion: 1,
    id: "synchronized-output",
    cols: 32,
    rows: 8,
    source: { kind: "protocol" },
    events: [
      output("before"),
      checkpoint("visible frame", { rows: { 0: "before" } }),
      output("\x1b[?2026h\x1b[Hafter \x1b[?25l"),
      checkpoint("held frame", {
        rows: { 0: "after" },
        renderedRows: { 0: "before" },
        modes: { synchronizedOutput: true },
        cursor: { visible: false },
      }),
      output("\x1b[?2026l\x1b[?25h"),
      checkpoint("released frame", {
        rows: { 0: "after" },
        modes: { synchronizedOutput: false },
        cursor: { visible: true },
      }),
    ],
  },
];
