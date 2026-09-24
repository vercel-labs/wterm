export const LOAD_COLS = 80;
export const LOAD_ROWS = 24;
export const LOAD_CHUNK_BYTES = 16 * 1024;
export const LOAD_WORKLOADS = ["plain", "ansi", "redraw"] as const;
export type LoadWorkload = (typeof LOAD_WORKLOADS)[number];

export function lineText(index: number): string {
  return `line ${String(index).padStart(8, "0")} The quick brown fox jumps over the lazy dog.`;
}

export function frameText(index: number, row: number): string {
  return (
    `frame ${String(index).padStart(8, "0")} row ${String(row).padStart(2, "0")} ` +
    "0123456789".repeat(6).slice(0, 58)
  );
}

function record(workload: LoadWorkload, index: number): string {
  if (workload === "plain") return `${lineText(index)}\r\n`;
  if (workload === "ansi") {
    return `\x1b[${31 + (index % 6)};1m${lineText(index)}\x1b[0m\r\n`;
  }
  return Array.from(
    { length: LOAD_ROWS },
    (_, row) =>
      `\x1b[${row + 1};1H\x1b[${31 + ((row + index) % 6)}m${frameText(index, row)}\x1b[0m`,
  ).join("");
}

// Records have constant encoded size within each workload. Round up to a whole
// record so a run never finishes inside an escape sequence or a screen redraw.
export function describeLoad(workload: LoadWorkload, targetBytes: number) {
  if (!LOAD_WORKLOADS.includes(workload)) throw new Error("Unknown workload");
  if (
    !Number.isSafeInteger(targetBytes) ||
    targetBytes < 1024 * 1024 ||
    targetBytes > 100 * 1024 * 1024
  ) {
    throw new Error("Load size must be an integer between 1 MiB and 100 MiB");
  }
  const recordBytes = new TextEncoder().encode(record(workload, 0)).length;
  const records = Math.ceil(targetBytes / recordBytes);
  return {
    version: 1,
    workload,
    cols: LOAD_COLS,
    rows: LOAD_ROWS,
    targetBytes,
    recordBytes,
    records,
    outputBytes: records * recordBytes,
    chunkBytes: LOAD_CHUNK_BYTES,
  };
}

// Keep only one record and one write chunk in memory, even for 100 MiB runs.
export function* loadChunks(spec: ReturnType<typeof describeLoad>) {
  const encoder = new TextEncoder();
  let chunk = new Uint8Array(LOAD_CHUNK_BYTES);
  let used = 0;
  for (let index = 0; index < spec.records; index++) {
    const bytes = encoder.encode(record(spec.workload, index));
    for (let offset = 0; offset < bytes.length;) {
      const count = Math.min(bytes.length - offset, chunk.length - used);
      chunk.set(bytes.subarray(offset, offset + count), used);
      used += count;
      offset += count;
      if (used === chunk.length) {
        yield chunk;
        chunk = new Uint8Array(LOAD_CHUNK_BYTES);
        used = 0;
      }
    }
  }
  if (used) yield chunk.subarray(0, used);
}

export function expectedRows(spec: ReturnType<typeof describeLoad>): string[] {
  if (spec.workload === "redraw") {
    return Array.from({ length: LOAD_ROWS }, (_, row) =>
      frameText(spec.records - 1, row),
    );
  }
  return [
    ...Array.from({ length: LOAD_ROWS - 1 }, (_, row) =>
      lineText(spec.records - LOAD_ROWS + 1 + row),
    ),
    "",
  ];
}
