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
    wasmPath: "https://wterm.test/clipboard.wasm",
  });
  core.init(40, 8);
});
afterEach(() => {
  core.dispose();
  vi.unstubAllGlobals();
});

function request(text: string, selection = "c", end = "\x1b\\") {
  return `\x1b]52;${selection};${Buffer.from(text).toString("base64")}${end}`;
}

it("delivers complete Unicode text once, including a leading BOM and line breaks", () => {
  const text = "\uFEFF語 e\u0301 😀\nsecond line\t";
  const bytes = Buffer.from(request(text));
  core.writeRaw(bytes.subarray(0, 9));
  expect(core.getClipboardWrite()).toBeNull();
  core.writeRaw(bytes.subarray(9, bytes.length - 2));
  expect(core.getClipboardWrite()).toBeNull();
  core.writeRaw(bytes.subarray(bytes.length - 2));
  expect(core.getClipboardWrite()).toBe(text);
  expect(core.getClipboardWrite()).toBeNull();
  expect(core.getResponse()).toBeNull();
});

it("supports the default clipboard, BEL termination, empty clears, and the latest pending write", () => {
  core.writeString(request("first") + request("last", "", "\x07"));
  expect(core.getClipboardWrite()).toBe("last");
  expect(core.getBellCount()).toBe(0);
  core.writeString(request(""));
  expect(core.getClipboardWrite()).toBe("");
  expect(core.getClipboardWrite()).toBeNull();
});

it("ignores reads, other selections, invalid base64 and invalid UTF-8 without damaging a pending request", () => {
  core.writeString(request("kept"));
  for (const selection of ["p", "s", "0"])
    core.writeString(request("ignored", selection));
  for (const encoded of ["?", "!bad", "/w=="])
    core.writeString(`\x1b]52;c;${encoded}\x07`);
  expect(core.getClipboardWrite()).toBe("kept");
  expect(core.getResponse()).toBeNull();
});

it("accepts 64 KiB, rejects larger requests in decoding and accumulation, then accepts normal output", () => {
  const text = "a".repeat(65536);
  core.writeString(request(text));
  expect(core.getClipboardWrite()).toBe(text);
  for (const length of [65537, 65540]) {
    core.writeString(request("b".repeat(length)));
    expect(core.getClipboardWrite()).toBeNull();
  }
  core.writeString(request("after") + "ok");
  expect(core.getClipboardWrite()).toBe("after");
  expect(core.getCell(0, 0).char).toBe("o".charCodeAt(0));
});

it("clears pending requests when the core is reinitialized or disposed", () => {
  core.writeString(request("old"));
  core.init(40, 8);
  expect(core.getClipboardWrite()).toBeNull();
  core.writeString(request("new"));
  core.dispose();
  expect(core.getClipboardWrite()).toBeNull();
});
