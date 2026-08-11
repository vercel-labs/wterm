import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GhosttyCore, type GhosttyOptions } from "../ghostty-core.js";

/**
 * Runs against the real committed wasm: the responses are produced by the Zig
 * stream handler, so a mocked core cannot observe them.
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

async function newCore(cols = 20, rows = 4, options: GhosttyOptions = {}) {
  const core = await GhosttyCore.load({ wasmPath: WASM_URL, ...options });
  core.init(cols, rows);
  return core;
}

function drain(core: GhosttyCore): string[] {
  const out: string[] = [];
  for (;;) {
    const response = core.getResponse();
    if (response === null) break;
    out.push(response);
  }
  return out;
}

describe("GhosttyCore terminal responses", () => {
  it("answers a cursor position report", async () => {
    const core = await newCore();
    core.writeString("ab\x1b[6n");
    expect(drain(core)).toEqual(["\x1b[1;3R"]);
  });

  it("answers primary device attributes", async () => {
    const core = await newCore();
    core.writeString("\x1b[c");
    expect(drain(core)).toEqual(["\x1b[?1;2c"]);
  });

  it("reports a mode from the same state the set path writes", async () => {
    const core = await newCore();
    core.writeString("\x1b[?2026$p");
    core.writeString("\x1b[?2026h\x1b[?2026$p");
    core.writeString("\x1b[?2026l\x1b[?2026$p");
    expect(drain(core)).toEqual([
      "\x1b[?2026;2$y",
      "\x1b[?2026;1$y",
      "\x1b[?2026;2$y",
    ]);
  });

  it("exposes synchronized output state and generations", async () => {
    const core = await newCore();
    expect(core.synchronizedOutput?.()).toBe(false);
    expect(core.synchronizedOutputGeneration?.()).toBe(0);

    core.writeString("\x1b[?2026h");
    expect(core.synchronizedOutput?.()).toBe(true);
    expect(core.synchronizedOutputGeneration?.()).toBe(1);

    core.writeString("\x1b[?2026h");
    expect(core.synchronizedOutputGeneration?.()).toBe(1);

    core.writeString("\x1b[?2026l");
    expect(core.synchronizedOutput?.()).toBe(false);
    expect(core.synchronizedOutputGeneration?.()).toBe(1);

    core.writeString("\x1b[?2026h");
    expect(core.synchronizedOutput?.()).toBe(true);
    expect(core.synchronizedOutputGeneration?.()).toBe(2);

    core.writeString("\x1b[?2026s\x1b[?2026l\x1b[?2026r");
    expect(core.synchronizedOutput?.()).toBe(true);
    expect(core.synchronizedOutputGeneration?.()).toBe(3);
  });

  it("says nothing to an ANSI-mode DECRQM, which ghostty 1.3.1 never dispatches", async () => {
    // `CSI Ps $ p` carries one intermediate. ghostty's stream switches on
    // `intermediates.len == 2` before testing for the ANSI form, so the ANSI
    // branch inside is unreachable and no action reaches any handler. The
    // handler unpacks the mode tag anyway, so it stays correct if that outer
    // switch ever widens; this test is what would notice the upgrade.
    const core = await newCore();
    core.writeString("\x1b[4$p");
    core.writeString("\x1b[7777$p");
    expect(drain(core)).toEqual([]);
  });

  it("reports an unrecognized mode as not recognized", async () => {
    const core = await newCore();
    core.writeString("\x1b[?7777$p");
    expect(drain(core)).toEqual(["\x1b[?7777;0$y"]);
  });

  it("answers foreground and background color queries", async () => {
    const core = await newCore();
    core.writeString("\x1b]10;?\x07\x1b]11;?\x1b\\");
    expect(drain(core)).toEqual([
      "\x1b]10;rgb:d4d4/d4d4/d4d4\x07",
      "\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\",
    ]);

    core.writeString("\x1b]10;#123456\x1b\\\x1b]10;?\x1b\\");
    expect(drain(core)).toEqual(["\x1b]10;rgb:1212/3434/5656\x1b\\"]);

    core.writeString("\x1b]110\x1b\\\x1b]10;?\x1b\\");
    expect(drain(core)).toEqual(["\x1b]10;rgb:d4d4/d4d4/d4d4\x1b\\"]);

    const themed = await newCore(20, 4, {
      foregroundColor: "#ededed",
      backgroundColor: "#0a0a0a",
    });
    themed.writeString("\x1b]10;?\x1b\\\x1b]11;?\x1b\\");
    expect(drain(themed)).toEqual([
      "\x1b]10;rgb:eded/eded/eded\x1b\\",
      "\x1b]11;rgb:0a0a/0a0a/0a0a\x1b\\",
    ]);
  });

  it("rejects invalid configured colors", async () => {
    await expect(
      GhosttyCore.load({
        wasmPath: WASM_URL,
        foregroundColor: "white",
      }),
    ).rejects.toThrow(
      "@wterm/ghostty: foregroundColor must be a #RRGGBB color",
    );
  });

  it("keeps replies in the order the queries arrived", async () => {
    const core = await newCore();
    core.writeString("\x1b[c\x1b[6n\x1b[5n");
    expect(drain(core)).toEqual(["\x1b[?1;2c", "\x1b[1;1R", "\x1b[0n"]);
  });

  it("still applies the state changes the readonly handler owned", async () => {
    const core = await newCore();
    core.writeString("hi\x1b[6n");
    core.update?.();
    expect(core.getCell(0, 0).char).toBe("h".codePointAt(0));
    expect(core.getCell(0, 1).char).toBe("i".codePointAt(0));
    expect(core.getCursor().col).toBe(2);
  });
});
