import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GhosttyCore } from "../ghostty-core.js";

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

async function newCore(cols = 20, rows = 4) {
  const core = await GhosttyCore.load({ wasmPath: WASM_URL });
  core.init(cols, rows);
  return core;
}

describe("GhosttyCore OSC 8 hyperlinks", () => {
  it("exposes exact BEL-terminated coverage and explicit identity", async () => {
    const core = await newCore();
    core.writeString(
      "\x1b]8;id=docs;https://example.com/docs\x07LINK\x1b]8;;\x07 plain",
    );

    const keys = new Set<string>();
    for (let col = 0; col < 4; col++) {
      const cell = core.getCell(0, col);
      expect(cell.linkUri).toBe("https://example.com/docs");
      expect(cell.linkId).toBe("docs");
      expect(cell.linkKey).toBeDefined();
      keys.add(cell.linkKey!);
    }
    expect(keys.size).toBe(1);
    expect(core.getCell(0, 4).linkUri).toBeUndefined();
  });

  it("does not retain every resolved hyperlink identity in JavaScript", async () => {
    const core = await newCore(2, 2);

    for (let index = 0; index < 1600; index++) {
      core.writeString(
        `\x1b]8;;https://example.com/${index}\x1b\\X\x1b]8;;\x1b\\\r`,
      );
      core.getCell(0, 0);
    }

    const largestRetainedMap = Object.values(
      core as unknown as Record<string, unknown>,
    ).reduce(
      (largest, value) =>
        value instanceof Map ? Math.max(largest, value.size) : largest,
      0,
    );

    expect(largestRetainedMap).toBeLessThanOrEqual(64);
  });

  it("keeps implicit opens distinct and accepts ST termination", async () => {
    const core = await newCore();
    core.writeString(
      "\x1b]8;;https://example.com\x1b\\A\x1b]8;;\x1b\\" +
        "\x1b]8;;https://example.com\x1b\\B\x1b]8;;\x1b\\",
    );

    expect(core.getCell(0, 0).linkKey).toBeDefined();
    expect(core.getCell(0, 1).linkKey).toBeDefined();
    expect(core.getCell(0, 0).linkKey).not.toBe(core.getCell(0, 1).linkKey);
  });

  it("clears metadata on overwrite and erase", async () => {
    const core = await newCore();
    core.writeString("\x1b]8;;https://example.com\x1b\\LINK\x1b]8;;\x1b\\");
    core.writeString("\rX\x1b[K");

    expect(core.getCell(0, 0).linkUri).toBeUndefined();
    expect(core.getCell(0, 1).linkUri).toBeUndefined();
  });

  it("preserves metadata on linked spaces", async () => {
    const core = await newCore();
    core.writeString("\x1b]8;;https://example.com/space\x1b\\ \x1b]8;;\x1b\\");

    expect(core.getCell(0, 0)).toMatchObject({
      char: 32,
      linkUri: "https://example.com/space",
    });
  });

  it("keeps metadata after the linked row enters scrollback", async () => {
    const core = await newCore();
    core.writeString(
      "\x1b]8;;https://example.com/history\x1b\\LINK\x1b]8;;\x1b\\\r\n",
    );
    for (let i = 0; i < 40; i++) core.writeString(`line ${i}\r\n`);

    const offset = core.getScrollbackCount() - 1;
    expect(core.getScrollbackCell(offset, 0).linkUri).toBe(
      "https://example.com/history",
    );
    expect(core.getScrollbackCell(offset, 4).linkUri).toBeUndefined();
  });

  it("keeps primary and alternate screen hyperlink cells isolated", async () => {
    const core = await newCore();
    core.writeString(
      "\x1b]8;;https://example.com/primary\x1b\\P\x1b]8;;\x1b\\",
    );
    expect(core.getCell(0, 0).linkUri).toBe("https://example.com/primary");

    core.writeString("\x1b[?1049h\x1b[H");
    expect(core.getCell(0, 0).linkUri).toBeUndefined();
    core.writeString("\x1b]8;;https://example.com/alt\x1b\\A\x1b]8;;\x1b\\");
    expect(core.getCell(0, 0).linkUri).toBe("https://example.com/alt");

    core.writeString("\x1b[?1049l");
    expect(core.getCell(0, 0).linkUri).toBe("https://example.com/primary");
  });
});
