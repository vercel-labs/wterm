import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WasmBridge, type TerminalCore } from "@wterm/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GhosttyCore } from "../../../ghostty/src/ghostty-core.js";
import { Renderer } from "../renderer.js";

const wasmUrl = "https://wterm.test/ghostty-cursor.wasm";
const wasm = readFileSync(
  resolve(process.cwd(), "../ghostty/wasm/ghostty-vt.wasm"),
);
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    String(input) === wasmUrl
      ? new Response(wasm)
      : realFetch(input as RequestInfo)) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe.each(["built-in", "Ghostty"])("cursor with the %s core", (name) => {
  async function createCore(): Promise<
    TerminalCore & { dispose?: () => void }
  > {
    const core =
      name === "Ghostty"
        ? await GhosttyCore.load({ wasmPath: wasmUrl })
        : await WasmBridge.load();
    core.init(20, 4);
    return core;
  }

  it("decodes fragmented DECSCUSR and mode 12 without moving the cursor", async () => {
    const core = await createCore();
    try {
      core.writeString("abc");
      for (const [param, shape, blinking] of [
        [1, "block", true],
        [2, "block", false],
        [3, "underline", true],
        [4, "underline", false],
        [5, "bar", true],
        [6, "bar", false],
        [0, "block", false],
      ] as const) {
        for (const byte of `\x1b[${param} q`) core.writeString(byte);
        expect(core.getCursor()).toEqual({
          row: 0,
          col: 3,
          visible: true,
          shape,
          blinking,
        });
      }
      core.writeString("\x1b[6 q\x1b[?12h");
      expect(core.getCursor()).toMatchObject({ shape: "bar", blinking: true });
      core.writeString("\x1b[?12l");
      expect(core.getCursor()).toMatchObject({ shape: "bar", blinking: false });
      core.writeString("\x1b[99 q\x1b[3q\x1b[?3 q");
      expect(core.getCursor()).toMatchObject({ shape: "bar", blinking: false });
      core.writeString("\x1b[ q");
      expect(core.getCursor()).toMatchObject({
        shape: "block",
        blinking: false,
      });
    } finally {
      core.dispose?.();
    }
  });

  it("preserves primary cursor shape across alternate screen use and resets on RIS", async () => {
    const core = await createCore();
    try {
      core.writeString("\x1b[6 q\x1b[?1049h");
      expect(core.getCursor().shape).toBe("bar");
      core.writeString("\x1b[3 q");
      core.resize(30, 6);
      expect(core.getCursor()).toMatchObject({
        shape: "underline",
        blinking: true,
      });
      core.writeString("\x1b[?1049l");
      // Shape is screen-local; blink mode belongs to the terminal.
      expect(core.getCursor()).toMatchObject({ shape: "bar", blinking: true });
      core.writeString("\x1b[?47h\x1b[4 q\x1b[?47l");
      expect(core.getCursor()).toMatchObject({
        shape: "underline",
        blinking: false,
      });
      core.writeString("\x1b[?25l\x1bc");
      expect(core.getCursor()).toMatchObject({
        shape: "block",
        blinking: false,
        visible: true,
      });
    } finally {
      core.dispose?.();
    }
  });

  it("renders shape, blink, and visibility changes after text rows are clean", async () => {
    const core = await createCore();
    const container = document.createElement("div");
    const renderer = new Renderer(container);
    try {
      core.writeString("hello\r");
      renderer.render(core);
      core.writeString("\x1b[5 q");
      renderer.render(core);
      expect(container.dataset.cursorShape).toBe("bar");
      expect(container.dataset.cursorBlink).toBe("true");
      core.writeString("\x1b[?25l");
      renderer.render(core);
      expect(container.querySelector(".term-cursor")).toBeNull();
      core.writeString("\x1b[?25h");
      renderer.render(core);
      expect(container.querySelector(".term-cursor")?.textContent).toBe("h");
    } finally {
      renderer.destroy();
      core.dispose?.();
    }
  });
});
