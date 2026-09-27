export const STABILITY_COLS = 80;
export const STABILITY_ROWS = 24;
export const STABILITY_BATCH_ROWS = 16;
export const STABILITY_HISTORY_BYTES = 64 * 1024;
export const STABILITY_WARMUP_BYTES = 1024 * 1024;
export const STABILITY_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const STABILITY_SAMPLE_LIMIT = 2000;
export const STABILITY_PROFILES = {
  smoke: { durationMs: 3000, minimumBytes: 128 * 1024, sampleIntervalMs: 1000 },
  soak: {
    durationMs: 30 * 60 * 1000,
    minimumBytes: 100 * 1024 * 1024,
    sampleIntervalMs: 10000,
  },
} as const;
export type StabilityProfile = keyof typeof STABILITY_PROFILES;

export function stabilityLine(index: number): string {
  // Vary the contents as well as the sequence number; keep records below 80 cells.
  const fingerprint = (Math.imul(index + 1, 2654435761) >>> 0)
    .toString(16)
    .padStart(8, "0");
  return `row ${String(index).padStart(10, "0")} ${fingerprint} The quick brown fox jumps over the lazy dog.`;
}

export function stabilityBatch(first: number) {
  return new TextEncoder().encode(
    Array.from({ length: STABILITY_BATCH_ROWS }, (_, offset) => {
      const index = first + offset;
      return `\x1b[${31 + (index % 6)};1m${stabilityLine(index)}\x1b[0m\r\n`;
    }).join(""),
  );
}
