import { WasmBridge } from "@wterm/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Renderer } from "../renderer.js";
import { scanText } from "../text-capture.js";

const REPLACEMENT = "�";

function capture(core: WasmBridge): string {
  const steps = scanText(core);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

describe("malformed UTF-8", () => {
  let bridge: WasmBridge;
  let container: HTMLDivElement;
  let renderer: Renderer;

  beforeEach(async () => {
    bridge = await WasmBridge.load();
    bridge.init(20, 4);
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = new Renderer(container);
    renderer.setup(20, 4);
  });

  afterEach(() => {
    renderer.destroy();
    container.remove();
  });

  it("renders and captures a lead byte above the four-byte range as replacements", () => {
    bridge.writeRaw(new Uint8Array([0xf7, 0xbf, 0xbf, 0xbf]));
    expect(() => renderer.render(bridge)).not.toThrow();
    expect(container.textContent).toContain(REPLACEMENT.repeat(4));
    expect(capture(bridge).trimEnd()).toBe(REPLACEMENT.repeat(4));
  });

  it("captures overlong and surrogate encodings as replacements", () => {
    bridge.writeRaw(new Uint8Array([0xc0, 0x80, 0xed, 0xa0, 0x80]));
    expect(() => renderer.render(bridge)).not.toThrow();
    expect(container.textContent).toContain(REPLACEMENT.repeat(5));
    expect(capture(bridge).trimEnd()).toBe(REPLACEMENT.repeat(5));
  });

  it("keeps a valid four-byte emoji searchable", () => {
    bridge.writeRaw(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]));
    expect(() => renderer.render(bridge)).not.toThrow();
    expect(container.textContent).toContain("\u{1F600}");
    expect(capture(bridge).trimEnd()).toBe("\u{1F600}");
  });
});
