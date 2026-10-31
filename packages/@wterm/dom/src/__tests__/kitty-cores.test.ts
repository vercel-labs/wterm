import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TerminalCore } from "@wterm/core";
import { WasmBridge } from "@wterm/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GhosttyCore } from "../../../ghostty/src/ghostty-core.js";
import { InputHandler } from "../input.js";

const GHOSTTY_WASM_URL = "https://wterm.test/ghostty-vt.wasm";
const ghosttyWasm = readFileSync(
  resolve(process.cwd(), "../ghostty/wasm/ghostty-vt.wasm"),
);
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === GHOSTTY_WASM_URL) {
      return new Response(ghosttyWasm, {
        headers: { "content-type": "application/wasm" },
      });
    }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

async function builtInCore(): Promise<TerminalCore> {
  const core = await WasmBridge.load();
  core.init(80, 24);
  return core;
}

async function ghosttyCore(): Promise<TerminalCore> {
  const core = await GhosttyCore.load({ wasmPath: GHOSTTY_WASM_URL });
  core.init(80, 24);
  return core;
}

describe.each([
  ["built-in", builtInCore],
  ["Ghostty", ghosttyCore],
] as const)("Kitty input with the %s core", (_name, createCore) => {
  it("drives InputHandler from the core's negotiated active-screen flags", async () => {
    const core = await createCore();
    core.writeString("\x1b[>31u");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const received: string[] = [];
    const input = new InputHandler(
      container,
      (data) => received.push(data),
      () => core,
    );
    const textarea = container.querySelector("textarea")!;

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "A",
        code: "KeyA",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    textarea.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "A",
        code: "KeyA",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(received).toEqual(["\x1b[97:65;2;65u", "\x1b[97:65;2:3u"]);

    input.destroy();
    container.remove();
  });
});
