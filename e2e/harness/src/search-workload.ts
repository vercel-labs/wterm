export const SEARCH_COLS = 80;
export const SEARCH_ROWS = 24;
export const SEARCH_HISTORY_BYTES = 128 * 1024 * 1024;
export const SEARCH_QUERIES = ["Needle", "not-in-this-corpus"] as const;

/** Fixed-width, hard-separated ASCII records; sparse matches include both ends. */
export function searchLine(index: number, lines: number): string {
  const marker =
    index % 1000 === 0 || index === lines - 1 ? "Needle" : "record";
  return `${String(index).padStart(8, "0")} ${marker} The quick brown fox jumps over the lazy dog.`;
}

export function searchMatchCount(lines: number): number {
  return Math.ceil(lines / 1000) + ((lines - 1) % 1000 === 0 ? 0 : 1);
}
