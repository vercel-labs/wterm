import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GhosttyCore } from "../ghostty-core.js";

const wasm = readFileSync(
  new URL("../../wasm/ghostty-vt.wasm", import.meta.url),
);
let core: GhosttyCore;
beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(wasm)),
  );
  core = await GhosttyCore.load({ wasmPath: "https://wterm.test/shell.wasm" });
  core.init(40, 8);
});
afterEach(() => {
  core.dispose();
  vi.unstubAllGlobals();
});
const mark = (value: string) => `\x1b]133;${value}\x07`;

it("delivers complete fragmented markers once and retains the result through prompt redraws", () => {
  expect(core.getShellIntegrationState()).toBeNull();
  core.writeRaw(Buffer.from("\x1b]133;A"));
  expect(core.getShellIntegrationState()).toBeNull();
  core.writeRaw(Buffer.from("\x1b\\"));
  expect(core.getShellIntegrationState()).toEqual({
    phase: "prompt",
    exitCode: null,
  });
  expect(core.getShellIntegrationState()).toBeNull();
  for (const [marker, phase, exitCode] of [
    ["B", "input", null],
    ["C", "running", null],
    ["D;7", "complete", 7],
    ["A;redraw=1", "prompt", 7],
    ["B", "input", 7],
    ["C", "running", null],
    ["D;0", "complete", 0],
  ] as const) {
    core.writeString(mark(marker));
    expect(core.getShellIntegrationState()).toEqual({ phase, exitCode });
  }
  expect(core.getBellCount()).toBe(0);
  expect(core.getResponse()).toBeNull();
});

it("coalesces unread changes into bounded current state and returns caller-owned snapshots", () => {
  core.writeString(
    (mark("C") + mark("D;0") + mark("A") + mark("B")).repeat(2000),
  );
  const result = core.getShellIntegrationState();
  expect(result).toEqual({ phase: "input", exitCode: 0 });
  result!.exitCode = 99;
  core.writeString(mark("A"));
  expect(core.getShellIntegrationState()).toEqual({
    phase: "prompt",
    exitCode: 0,
  });
  core.writeString(mark("A"));
  expect(core.getShellIntegrationState()).toBeNull();
});

it("supports semantic-prompt variants and ignores invalid commands without inventing exit codes", () => {
  for (const [marker, phase] of [
    ["N", "prompt"],
    ["I", "input"],
    ["P;k=c", "prompt"],
  ] as const) {
    core.writeString(mark(marker));
    expect(core.getShellIntegrationState()).toEqual({ phase, exitCode: null });
  }
  for (const marker of ["L", "Z", "", "Cbad"]) {
    core.writeString(mark(marker));
    expect(core.getShellIntegrationState()).toBeNull();
  }
  for (const status of ["", "bad", "2147483648", "-2147483649"]) {
    core.writeString(mark("C") + mark(`D;${status}`));
    expect(core.getShellIntegrationState()).toEqual({
      phase: "complete",
      exitCode: null,
    });
  }
  for (const status of [-2147483648, -1, 2147483647]) {
    core.writeString(mark(`D;${status}`));
    expect(core.getShellIntegrationState()).toEqual({
      phase: "complete",
      exitCode: status,
    });
  }
});

it("keeps command state through alternate-screen programs and resizes, and resets on RIS", () => {
  core.writeString(mark("C") + "\x1b[?1049h" + mark("D;99"));
  expect(core.getShellIntegrationState()).toEqual({
    phase: "running",
    exitCode: null,
  });
  core.resize(60, 12);
  expect(core.getShellIntegrationState()).toBeNull();
  core.writeString("\x1b[?1049l" + mark("D;0"));
  expect(core.getShellIntegrationState()).toEqual({
    phase: "complete",
    exitCode: 0,
  });
  core.writeString("\x1bc");
  expect(core.getShellIntegrationState()).toEqual({
    phase: "unknown",
    exitCode: null,
  });
  expect(core.getShellIntegrationState()).toBeNull();
  core.writeString(mark("C"));
  core.init(40, 8);
  expect(core.getShellIntegrationState()).toBeNull();
  core.writeString(mark("C"));
  core.dispose();
  expect(core.getShellIntegrationState()).toBeNull();
});
