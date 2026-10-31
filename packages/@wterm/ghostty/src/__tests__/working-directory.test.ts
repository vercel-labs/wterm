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
  core = await GhosttyCore.load({
    wasmPath: "https://wterm.test/directory.wasm",
  });
  core.init(40, 8);
});
afterEach(() => {
  core.dispose();
  vi.unstubAllGlobals();
});
const report = (uri: string) => `\x1b]7;${uri}\x1b\\`;

it("waits for fragmented UTF-8 reports and consumes BEL/ST-terminated updates once", () => {
  const uri = "file://remote/home/日本語/project%20name";
  const bytes = Buffer.from(report(uri));
  for (const byte of bytes.subarray(0, -2)) {
    core.writeRaw(Uint8Array.of(byte));
    expect(core.getWorkingDirectory()).toBeNull();
  }
  // The upstream parser ends OSC on ESC, before the trailing ST backslash.
  core.writeRaw(bytes.subarray(-2, -1));
  expect(core.getWorkingDirectory()).toBe(uri);
  core.writeRaw(bytes.subarray(-1));
  expect(core.getWorkingDirectory()).toBeNull();
  core.writeString("\x1b]7;file:///tmp\x07");
  expect(core.getWorkingDirectory()).toBe("file:///tmp");
  expect(core.getBellCount()).toBe(0);
  expect(core.getResponse()).toBeNull();
});

it("coalesces unread reports, suppresses repeats, and passes URI metadata without interpreting it", () => {
  core.writeString(
    (report("file:///one") + report("file://remote/two")).repeat(1000),
  );
  expect(core.getWorkingDirectory()).toBe("file://remote/two");
  core.writeString(report("file://remote/two"));
  expect(core.getWorkingDirectory()).toBeNull();
  core.writeString(report("other://untrusted/value"));
  expect(core.getWorkingDirectory()).toBe("other://untrusted/value");
  core.writeString(report(""));
  expect(core.getWorkingDirectory()).toBe("");
  expect(core.getWorkingDirectory()).toBeNull();
});

it("bounds retained URI bytes and rejects invalid UTF-8 without losing a pending report", () => {
  const uri = "file:///" + "x".repeat(2047 - 8);
  core.writeString(report(uri));
  core.writeString(report(uri + "x"));
  core.writeRaw(Buffer.from([27, 93, 55, 59, 0xff, 7]));
  expect(core.getWorkingDirectory()).toBe(uri);
  expect(core.getWorkingDirectory()).toBeNull();
});

it("reports in either screen, retains state across resize, and clears on RIS or reinitialization", () => {
  core.writeString("\x1b[?1049h" + report("file://remote/alternate"));
  expect(core.getWorkingDirectory()).toBe("file://remote/alternate");
  core.resize(60, 12);
  core.writeString("\x1b[?1049l");
  expect(core.getWorkingDirectory()).toBeNull();
  core.writeString("\x1bc");
  expect(core.getWorkingDirectory()).toBe("");
  core.writeString(report("file:///old"));
  core.init(40, 8);
  expect(core.getWorkingDirectory()).toBeNull();
  core.writeString(report("file:///new"));
  core.dispose();
  expect(core.getWorkingDirectory()).toBeNull();
});
