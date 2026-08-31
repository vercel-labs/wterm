import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GhosttyCore, type GhosttyOptions } from "../ghostty-core.js";

/**
 * These cases intentionally use the committed WASM. The bug lives in
 * Ghostty's page movement and only appears when managed page data (hyperlinks
 * or graphemes) crosses page boundaries, so a mocked binding cannot cover it.
 */
const WASM_URL = "https://wterm.test/ghostty-vt.wasm";
const wasmBytes = readFileSync(
  fileURLToPath(new URL("../../wasm/ghostty-vt.wasm", import.meta.url)),
);
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === WASM_URL) {
      return new Response(wasmBytes, {
        headers: { "content-type": "application/wasm" },
      });
    }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

const COLS = 120;
const ROWS = 30;
const LARGE_SCROLLBACK = 64 * 1024 * 1024;

async function newCore(options: GhosttyOptions = {}) {
  const core = await GhosttyCore.load({
    wasmPath: WASM_URL,
    scrollbackLimit: LARGE_SCROLLBACK,
    ...options,
  });
  core.init(COLS, ROWS);
  return core;
}

function osc8(uri: string, text: string, id?: string): string {
  const identity = id === undefined ? "" : `id=${id};`;
  return `\x1b]8;${identity}${uri}\x1b\\${text}\x1b]8;;\x1b\\`;
}

function line(uri: string, text: string, id?: string): string {
  return `${osc8(uri, text, id)}\r\n`;
}

function assertSentinelAndCursor(core: GhosttyCore, marker: string): void {
  core.writeString(marker);
  const cursor = core.getCursor();
  expect(cursor.col).toBe(marker.length);
  expect(cursor.row).toBeLessThan(core.getRows());
  for (let col = 0; col < marker.length; col++) {
    expect(core.getCell(cursor.row, col).char).toBe(marker.codePointAt(col));
  }
}

function assertScrollbackUsable(core: GhosttyCore): number {
  const count = core.getScrollbackCount();
  expect(count).toBeGreaterThan(0);
  expect(core.getScrollbackLineLen(0)).toBeGreaterThan(0);
  return count;
}

describe("GhosttyCore page-capacity regression", () => {
  it("survives the short distinct-OSC-8-lines repro", async () => {
    const core = await newCore();
    const lines = Array.from({ length: 32 }, (_, index) =>
      line(
        `https://example.com/short/${index}`,
        `short-${index}`,
        `s-${index}`,
      ),
    ).join("");

    expect(() => core.writeString(lines)).not.toThrow();
    const scrollbackCount = core.getScrollbackCount();
    expect(scrollbackCount).toBeGreaterThan(0);
    for (const offset of [0, scrollbackCount - 1]) {
      const lineIndex = 32 - ROWS - offset;
      expect(core.getScrollbackCell(offset, 0).linkUri).toBe(
        `https://example.com/short/${lineIndex}`,
      );
      expect(core.getScrollbackCell(offset, 0).linkId).toBe(`s-${lineIndex}`);
    }
    assertSentinelAndCursor(core, "short-sentinel");
  });

  it("keeps 2,000 distinct long hyperlinks readable", async () => {
    const core = await newCore();
    const total = 2000;
    const uri = (index: number) =>
      `https://example.com/long/${index}-${"x".repeat(128)}`;
    core.writeString(
      Array.from({ length: total }, (_, index) =>
        line(uri(index), `long-${index}`, `long-${index}`),
      ).join(""),
    );

    const count = assertScrollbackUsable(core);
    for (const offset of [0, Math.floor(count / 2), count - 1]) {
      const lineIndex = total - ROWS - offset;
      expect(core.getScrollbackCell(offset, 0)).toMatchObject({
        linkUri: uri(lineIndex),
        linkId: `long-${lineIndex}`,
      });
    }
    assertSentinelAndCursor(core, "long-sentinel");
  });

  it("keeps 500 repeated-URI hyperlink rows usable", async () => {
    const core = await newCore();
    const uri = "https://example.com/repeated-uri";
    core.writeString(
      Array.from({ length: 500 }, (_, index) =>
        line(uri, `repeat-${index}`, `repeat-${index}`),
      ).join(""),
    );

    const count = assertScrollbackUsable(core);
    for (const offset of [0, Math.floor(count / 2), count - 1]) {
      expect(core.getScrollbackCell(offset, 0)).toMatchObject({
        linkUri: uri,
        linkId: `repeat-${500 - ROWS - offset}`,
      });
    }
    assertSentinelAndCursor(core, "repeat-sentinel");
  });

  it("preserves complete ZWJ family graphemes across page movement", async () => {
    const core = await newCore();
    const family = "👨‍👩‍👧‍👦";
    core.writeString(
      Array.from(
        { length: 500 },
        (_, index) => `${family} family-${index}\r\n`,
      ).join(""),
    );

    const count = assertScrollbackUsable(core);
    for (const offset of [0, Math.floor(count / 2), count - 1]) {
      expect(core.getScrollbackCell(offset, 0).chars).toBe(family);
    }
    assertSentinelAndCursor(core, "grapheme-sentinel");
  });

  it("preserves hyperlinks and graphemes under mixed page pressure", async () => {
    const core = await newCore();
    const family = "👨‍👩‍👧‍👦";
    const uri = (index: number) => `https://example.com/mixed/${index}`;
    core.writeString(
      Array.from({ length: 500 }, (_, index) =>
        line(uri(index), family, `mixed-${index}`),
      ).join(""),
    );

    const count = assertScrollbackUsable(core);
    for (const offset of [0, Math.floor(count / 2), count - 1]) {
      const lineIndex = 500 - ROWS - offset;
      expect(core.getScrollbackCell(offset, 0)).toMatchObject({
        chars: family,
        linkUri: uri(lineIndex),
        linkId: `mixed-${lineIndex}`,
      });
    }
    assertSentinelAndCursor(core, "mixed-sentinel");
  });

  it("keeps linked scrollback readable after a column-halving resize", async () => {
    const core = await newCore();
    const total = 300;
    const uri = (index: number) => `https://example.com/resize/${index}`;
    core.writeString(
      Array.from({ length: total }, (_, index) =>
        line(
          uri(index),
          `resize-${index} ${"r".repeat(94)}`,
          `resize-${index}`,
        ),
      ).join(""),
    );

    expect(core.getScrollbackCount()).toBeGreaterThan(0);
    core.resize(COLS / 2, ROWS);
    expect(core.getCols()).toBe(COLS / 2);

    const count = assertScrollbackUsable(core);
    // A 120-column row in this vector reflows into two 60-column rows. These
    // checkpoints cover the newest retained row, a cross-page middle row,
    // and the oldest retained row without depending on a crash threshold.
    expect(count).toBe(571);
    expect(core.getScrollbackCell(0, 0).linkUri).toBe(uri(285));
    expect(core.getScrollbackCell(285, 0).linkUri).toBe(uri(142));
    expect(core.getScrollbackCell(count - 1, 0).linkUri).toBe(uri(0));
    const seen = new Set<string>();
    for (let offset = 0; offset < count; offset++) {
      const linkUri = core.getScrollbackCell(offset, 0).linkUri;
      if (linkUri) seen.add(linkUri);
    }
    expect(count).toBeGreaterThan(0);
    expect(seen.size).toBeGreaterThan(0);
    expect(core.getScrollbackCell(0, 0).linkUri).toBeDefined();
    expect(core.getScrollbackCell(count - 1, 0).linkUri).toBeDefined();
    assertSentinelAndCursor(core, "resize-sentinel");
  });
});
