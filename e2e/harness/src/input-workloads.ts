export const INPUT_COLS = 80;
export const INPUT_ROWS = 24;
export const INPUT_WORKLOADS = ["idle", "ansi", "redraw"] as const;
export type InputWorkload = (typeof INPUT_WORKLOADS)[number];

// Whole records keep keyboard echo from interrupting a partial escape sequence.
// Reserve the first row for echo; output scrolls or redraws rows 2 through 24.
export function inputFixture(workload: InputWorkload): Uint8Array[] {
  if (workload === "idle") return [];
  const encoder = new TextEncoder();
  return Array.from({ length: 32 }, (_, batch) => {
    const text = (row: number) =>
      `batch ${String(batch).padStart(2, "0")} row ${String(row).padStart(3, "0")} ` +
      "0123456789".repeat(5);
    const record = (index: number) =>
      workload === "ansi"
        ? `\x1b[${31 + (index % 6)}m${text(index)}\x1b[0m\r\n`
        : Array.from(
            { length: INPUT_ROWS - 1 },
            (_, row) =>
              `\x1b[${row + 2};1H\x1b[${31 + ((row + batch) % 6)}m${text(row)}\x1b[0m`,
          ).join("");
    const count = Math.floor(16384 / encoder.encode(record(0)).length);
    return encoder.encode(
      Array.from({ length: count }, (_, i) => record(i)).join(""),
    );
  });
}
