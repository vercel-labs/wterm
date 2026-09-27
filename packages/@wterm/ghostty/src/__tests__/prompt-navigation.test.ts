import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GhosttyCore } from "../ghostty-core.js";

const wasm = readFileSync(
  new URL("../../wasm/ghostty-vt.wasm", import.meta.url),
);
const marker = (value: string) => `\x1b]133;${value}\x07`;
let core: GhosttyCore;
beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(wasm)),
  );
  core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/prompts.wasm",
  });
  core.init(20, 4);
});
afterEach(() => {
  core.dispose();
  vi.unstubAllGlobals();
});

const command = (name: string) =>
  marker("A;redraw=0") +
  name +
  "> " +
  marker("B") +
  "echo ok" +
  marker("C") +
  "\r\noutput\r\n" +
  marker("D;0");

it("finds retained prompt starts in either direction without consuming shell state or moving the cursor", () => {
  core.writeString(command("one") + command("two") + command("three"));
  const cursor = core.getCursor();
  expect(core.findPrompt(0, 1)).toBe(2);
  expect(core.findPrompt(2, 1)).toBe(4);
  expect(core.findPrompt(4, -1)).toBe(2);
  expect(core.findPrompt(3, -1)).toBe(2);
  expect(core.findPrompt(1, -1)).toBe(0);
  expect(core.findPrompt(0, -1)).toBeNull();
  expect(core.findPrompt(4, 1)).toBeNull();
  expect(core.getCursor()).toEqual(cursor);
  expect(core.getShellIntegrationState()).toEqual({
    phase: "complete",
    exitCode: 0,
  });
});

it("groups wrapped and explicit continuation prompts, including fragmented markers", () => {
  core.writeString(
    marker("P") +
      "first prompt with a long line\r\n" +
      marker("P;k=c") +
      "continued> " +
      marker("B") +
      "input" +
      marker("C") +
      "\r\nout\r\n",
  );
  core.writeRaw(Buffer.from("\x1b]133;A;redraw=0"));
  expect(core.findPrompt(0, 1)).toBeNull();
  core.writeRaw(Buffer.from("\x1b\\next> " + marker("B")));
  expect(core.findPrompt(0, 1)).toBe(4);
  expect(core.findPrompt(1, 1)).toBe(4);
  expect(core.findPrompt(2, -1)).toBe(0);
  expect(core.findPrompt(4, -1)).toBe(0);
});

it("reads reflowed prompt locations and forgets erased or reset history", () => {
  core.writeString(command("one") + command("two") + command("three"));
  core.resize(10, 4);
  expect(core.findPrompt(0, 1)).toBe(3);
  expect(core.findPrompt(3, 1)).toBe(6);
  expect(core.findPrompt(6, -1)).toBe(3);
  core.writeString("\x1b[3J");
  expect(core.findPrompt(0, -1)).toBeNull();
  core.writeString("\x1bc");
  expect(core.findPrompt(0, 1)).toBeNull();
});

it("uses only retained history after pruning and ignores the alternate screen", async () => {
  core.dispose();
  core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/prompts.wasm",
    scrollbackLimit: 4096,
  });
  core.init(80, 24);
  core.writeString(
    Array.from({ length: 20000 }, (_, i) => command(String(i))).join(""),
  );
  expect(core.getScrollbackDiscardedCount()).toBeGreaterThan(0);
  const total = core.getScrollbackCount() + core.getRows();
  const latest = core.findPrompt(total - 1, -1);
  expect(latest).not.toBeNull();
  expect(latest).toBeLessThan(total);
  expect(core.findPrompt(total, -1)).toBeNull();
  core.writeString("\x1b[?1049h" + command("alternate"));
  expect(core.findPrompt(0, 1)).toBeNull();
  core.writeString("\x1b[?1049l");
  expect(core.findPrompt(total - 1, -1)).toBe(latest);
});

it("rejects invalid coordinates/directions and stays safe after reinitialization and disposal", () => {
  core.writeString(command("one") + command("two"));
  for (const row of [-1, 0.5, NaN, Infinity, 2 ** 32, 100000])
    expect(core.findPrompt(row, -1)).toBeNull();
  for (const direction of [0, 2, NaN])
    expect(core.findPrompt(0, direction as 1)).toBeNull();
  core.init(20, 4);
  expect(core.findPrompt(0, 1)).toBeNull();
  core.dispose();
  expect(core.findPrompt(0, 1)).toBeNull();
});
