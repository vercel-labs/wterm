import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalCore } from "@wterm/core";
import { InputHandler } from "../input.js";

describe("InputHandler mouse and focus modes", () => {
  let container: HTMLDivElement;
  let received: string[];
  let handler: InputHandler;
  let core: TerminalCore;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.padding = "0";
    container.style.border = "0";
    document.body.appendChild(container);
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
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
    container.querySelector("textarea")!.focus({ preventScroll: true });
    received = [];
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
    window.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 1, clientX: 105, clientY: 75 }),
    );
    window.dispatchEvent(
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
      "\x1b[<0;8;4M",
      "\x1b[<32;10;5M",
      "\x1b[<0;10;5m",
      "\x1b[<65;10;5M",
    ]);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("preserves drag buttons and both wheel axes", () => {
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 2,
        buttons: 2,
        clientX: 105,
        clientY: 75,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 2,
        clientX: 105,
        clientY: 75,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", { button: 2, clientX: 105, clientY: 75 }),
    );
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 1,
        buttons: 4,
        clientX: 105,
        clientY: 75,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 4,
        clientX: 105,
        clientY: 75,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", { button: 1, clientX: 105, clientY: 75 }),
    );
    container.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: -100,
        clientX: 105,
        clientY: 75,
      }),
    );
    container.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 100,
        clientX: 105,
        clientY: 75,
      }),
    );
    container.dispatchEvent(
      new WheelEvent("wheel", {
        clientX: 105,
        clientY: 75,
      }),
    );

    expect(received).toEqual([
      "\x1b[<2;10;5M",
      "\x1b[<34;10;5M",
      "\x1b[<2;10;5m",
      "\x1b[<1;10;5M",
      "\x1b[<33;10;5M",
      "\x1b[<1;10;5m",
      "\x1b[<66;10;5M",
      "\x1b[<67;10;5M",
    ]);
  });

  it("captures a drag until release outside the terminal", () => {
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 25,
        clientY: 35,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 900,
        clientY: 500,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", { button: 0, clientX: 900, clientY: 500 }),
    );

    expect(received).toEqual([
      "\x1b[<0;2;1M",
      "\x1b[<32;80;40M",
      "\x1b[<0;80;40m",
    ]);
  });

  it("ignores drags that started outside the terminal", () => {
    container.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 25,
        clientY: 35,
      }),
    );
    expect(received).toEqual([]);
  });

  it("uses the visible viewport instead of scrollback geometry", () => {
    const grid = document.createElement("div");
    grid.className = "term-grid";
    Object.defineProperty(grid, "getBoundingClientRect", {
      value: () => ({ left: 10, top: -380, width: 800, height: 800 }),
    });
    container.appendChild(grid);

    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 105,
        clientY: 215,
      }),
    );

    expect(received).toEqual(["\x1b[<0;10;20M"]);
  });

  it("measures cells from the content box", () => {
    container.style.padding = "10px";
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 820, height: 420 }),
    });

    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 30,
      }),
    );

    expect(received).toEqual(["\x1b[<0;1;1M"]);
  });

  it("keeps capture until every pressed button is released", () => {
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 25,
        clientY: 35,
      }),
    );
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 2,
        buttons: 3,
        clientX: 25,
        clientY: 35,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        button: 0,
        buttons: 2,
        clientX: 25,
        clientY: 35,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 2,
        clientX: 35,
        clientY: 45,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        button: 2,
        buttons: 0,
        clientX: 35,
        clientY: 45,
      }),
    );

    expect(received).toEqual([
      "\x1b[<0;2;1M",
      "\x1b[<2;2;1M",
      "\x1b[<0;2;1m",
      "\x1b[<34;3;2M",
      "\x1b[<2;3;2m",
    ]);
  });

  it("does not capture a press without terminal geometry", () => {
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    });
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
      }),
    );
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 800, height: 400 }),
    });
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        button: 0,
        buttons: 0,
        clientX: 25,
        clientY: 35,
      }),
    );

    expect(received).toEqual([]);
  });

  it("captures mouse events on the element's owning window", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const iframeWindow = iframe.contentWindow!;
    const iframeContainer = iframe.contentDocument!.createElement("div");
    iframe.contentDocument!.body.appendChild(iframeContainer);
    Object.defineProperty(iframeContainer, "getBoundingClientRect", {
      value: () => ({ left: 10, top: 20, width: 800, height: 400 }),
    });
    const iframeReceived: string[] = [];
    const iframeHandler = new InputHandler(
      iframeContainer,
      (data) => iframeReceived.push(data),
      () => core,
    );

    iframeContainer.dispatchEvent(
      new iframeWindow.MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 25,
        clientY: 35,
      }),
    );
    iframeWindow.dispatchEvent(
      new iframeWindow.MouseEvent("mouseup", {
        button: 0,
        buttons: 0,
        clientX: 25,
        clientY: 35,
      }),
    );

    expect(iframeReceived).toEqual(["\x1b[I", "\x1b[<0;2;2M", "\x1b[<0;2;2m"]);
    iframeHandler.destroy();
    iframe.remove();
  });

  it("emits focus reports only when mode 1004 is enabled", () => {
    const textarea = container.querySelector("textarea")!;
    textarea.dispatchEvent(new FocusEvent("blur"));
    expect(received).toEqual(["\x1b[O"]);

    received = [];
    core.focusEvents = () => false;
    textarea.dispatchEvent(new FocusEvent("focus"));
    textarea.dispatchEvent(new FocusEvent("blur"));
    expect(received).toEqual([]);
  });

  it("preserves native shift selection", () => {
    const event = new MouseEvent("mousedown", {
      button: 0,
      buttons: 1,
      shiftKey: true,
      clientX: 25,
      clientY: 35,
      cancelable: true,
    });
    container.dispatchEvent(event);

    expect(received).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    ["MacIntel", "Meta", { metaKey: true }],
    ["Win32", "Control", { ctrlKey: true }],
  ])("does not send %s-click on %s to mouse tracking", (platform, _, init) => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
    const link = document.createElement("a");
    link.className = "term-link";
    container.appendChild(link);
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: 25,
      clientY: 35,
      cancelable: true,
      ...init,
    });
    link.dispatchEvent(event);

    expect(received).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    ["MacIntel", { ctrlKey: true }],
    ["Win32", { metaKey: true }],
  ])(
    "keeps the non-native modifier owned by mouse tracking on %s",
    (platform, init) => {
      vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
      const link = document.createElement("a");
      link.className = "term-link";
      container.appendChild(link);
      link.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 25,
          clientY: 35,
          cancelable: true,
          ...init,
        }),
      );

      expect(received).toHaveLength(1);
    },
  );

  it("ignores browser navigation buttons", () => {
    const event = new MouseEvent("mousedown", {
      button: 3,
      buttons: 8,
      clientX: 25,
      clientY: 35,
      cancelable: true,
    });
    container.dispatchEvent(event);

    expect(received).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not retain unsupported buttons during capture", () => {
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 25,
        clientY: 35,
      }),
    );
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 3,
        buttons: 9,
        clientX: 25,
        clientY: 35,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        button: 0,
        buttons: 8,
        clientX: 25,
        clientY: 35,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 8,
        clientX: 35,
        clientY: 45,
      }),
    );

    expect(received).toEqual(["\x1b[<0;2;1M", "\x1b[<0;2;1m"]);
  });

  it("uses measured cell width when the host has spare width", () => {
    const row = document.createElement("div");
    row.className = "term-row";
    Object.defineProperty(row, "getBoundingClientRect", {
      value: () => ({ left: 10, top: 20, width: 640, height: 10 }),
    });
    container.appendChild(row);
    const measured = new InputHandler(
      container,
      (data) => received.push(data),
      () => core,
      () => ({ charWidth: 8, rowHeight: 10 }),
    );
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 90,
        clientY: 30,
      }),
    );

    expect(received.at(-1)).toBe("\x1b[<0;11;2M");
    measured.destroy();
  });

  it("does not recalculate styles when measured geometry is available", () => {
    handler.destroy();
    const row = document.createElement("div");
    row.className = "term-row";
    Object.defineProperty(row, "getBoundingClientRect", {
      value: () => ({ left: 10, top: 20, width: 640, height: 10 }),
    });
    container.appendChild(row);
    handler = new InputHandler(
      container,
      (data) => received.push(data),
      () => core,
      () => ({ charWidth: 8, rowHeight: 10 }),
    );
    const getComputedStyle = vi.spyOn(window, "getComputedStyle");

    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 25,
        clientY: 35,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 35,
        clientY: 45,
      }),
    );

    expect(getComputedStyle).not.toHaveBeenCalled();
  });

  it("reports focus before the first mouse press after blur", () => {
    const textarea = container.querySelector("textarea")!;
    textarea.dispatchEvent(new FocusEvent("blur"));
    received = [];

    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 25,
        clientY: 35,
      }),
    );

    expect(received).toEqual(["\x1b[I", "\x1b[<0;2;1M"]);
  });
});
