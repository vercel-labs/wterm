import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TerminalCore } from "@wterm/core";
import { InputHandler } from "../input.js";

describe("InputHandler mouse and focus modes", () => {
  let container: HTMLDivElement;
  let received: string[];
  let handler: InputHandler;
  let core: TerminalCore;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({
        left: 10,
        top: 20,
        width: 800,
        height: 400,
      }),
    });
    received = [];
    core = {
      getCols: () => 80,
      getRows: () => 40,
      mouseTracking: () => 1002,
      mouseSgr: () => true,
      focusEvents: () => true,
    } as unknown as TerminalCore;
    handler = new InputHandler(
      container,
      (data) => received.push(data),
      () => core,
    );
  });

  afterEach(() => {
    handler.destroy();
    container.remove();
  });

  it("encodes SGR press, drag, release, and wheel", () => {
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 85,
        clientY: 65,
      }),
    );
    container.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 1, clientX: 105, clientY: 75 }),
    );
    container.dispatchEvent(
      new MouseEvent("mouseup", { button: 0, clientX: 105, clientY: 75 }),
    );
    const wheel = new WheelEvent("wheel", {
      deltaY: 100,
      clientX: 105,
      clientY: 75,
      cancelable: true,
    });
    container.dispatchEvent(wheel);

    expect(received).toEqual([
      "\x1b[<0;8;5M",
      "\x1b[<32;10;6M",
      "\x1b[<0;10;6m",
      "\x1b[<65;10;6M",
    ]);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("emits focus reports only when mode 1004 is enabled", () => {
    const textarea = container.querySelector("textarea")!;
    textarea.dispatchEvent(new FocusEvent("focus"));
    textarea.dispatchEvent(new FocusEvent("blur"));
    expect(received).toEqual(["\x1b[I", "\x1b[O"]);

    received = [];
    core.focusEvents = () => false;
    textarea.dispatchEvent(new FocusEvent("focus"));
    textarea.dispatchEvent(new FocusEvent("blur"));
    expect(received).toEqual([]);
  });
});
