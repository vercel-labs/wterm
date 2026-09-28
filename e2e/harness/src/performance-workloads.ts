export const COLS = 100;
export const ROWS = 30;
// Stay below both cores' history limits so comparisons retain identical data.
export const HISTORY_LINES = 900;
export const HISTORY_ROWS = HISTORY_LINES - ROWS + 1;
export const SCROLL_FIXTURES = ["plain", "ansi", "unicode"] as const;
export const REDRAW_FIXTURES = ["unicode", "ansi", "boxes"] as const;
export type Fixture = "plain" | "ansi" | "unicode" | "boxes";
export type Workload =
  | { kind: "scroll"; fixture: Fixture; step: 1 | 15; frames: number }
  | {
      kind: "redraw";
      fixture: Fixture;
      replacement: boolean;
      frames: number;
    };

export function rowText(fixture: Fixture, index: number, alternate = false) {
  const payload =
    fixture === "plain"
      ? "abcdefghijklmnop".repeat(4)
      : fixture === "boxes"
        ? (alternate ? "└───┴───┘" : "├───┼───┤").repeat(7)
        : (alternate ? "語😎à test " : "界😀é test ").repeat(6);
  return `row ${String(index).padStart(5, "0")} ${payload}`;
}

function rowOutput(fixture: Fixture, index: number, alternate = false) {
  const text = rowText(fixture, index, alternate);
  return fixture === "ansi" ? `\x1b[33;44m${text}\x1b[0m` : text;
}

export function historyOutput(fixture: Fixture) {
  return Array.from(
    { length: HISTORY_LINES },
    (_, index) => `${rowOutput(fixture, index)}\r\n`,
  ).join("");
}

export function redrawOutput(
  fixture: Fixture,
  index: number,
  replacement: boolean,
) {
  return Array.from(
    { length: ROWS },
    (_, row) =>
      `\x1b[${row + 1};1H${rowOutput(fixture, index, replacement && index % 2 === 1)}`,
  ).join("");
}

export function scrollRow(index: number, step: number) {
  const phase = index % 60;
  return 100 + Math.min(phase, 60 - phase) * step;
}
