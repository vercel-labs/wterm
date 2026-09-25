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

  it("encodes X10 press, drag, release, and wheel without SGR mode", () => {
    core.mouseSgr = () => false;
    core.mouseEncoding = () => "x10";
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
    container.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, clientX: 105, clientY: 75 }),
    );

    expect(received).toEqual([
      String.fromCharCode(27, 91, 77, 32, 40, 36),
      String.fromCharCode(27, 91, 77, 64, 42, 37),
      String.fromCharCode(27, 91, 77, 35, 42, 37),
      String.fromCharCode(27, 91, 77, 97, 42, 37),
    ]);
  });

  it("routes X10 reports with non-ASCII coordinates as raw bytes", () => {
    handler.destroy();
    const binary: Uint8Array[] = [];
    core.mouseEncoding = () => "x10";
    core.mouseSgr = () => false;
    core.getCols = () => 160;
    core.getRows = () => 100;
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 1600, height: 1000 }),
    });
    handler = new InputHandler(
      container,
      (data) => received.push(data),
      () => core,
      undefined,
      undefined,
      (data) => binary.push(data),
    );
    container.querySelector("textarea")!.focus({ preventScroll: true });
    received = [];
    const event = new MouseEvent("mousedown", {
      button: 0,
      buttons: 1,
      clientX: 1005,
      clientY: 995,
      cancelable: true,
    });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(received).toEqual([]);
    expect(binary.map((data) => Array.from(data))).toEqual([
      [27, 91, 77, 32, 132, 131],
    ]);
  });

  it("does not turn X10 coordinates into UTF-8 when no binary consumer is set", () => {
    core.mouseEncoding = () => "x10";
    core.mouseSgr = () => false;
    core.getCols = () => 160;
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 1600, height: 400 }),
    });
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 1005,
        clientY: 35,
      }),
    );
    expect(received).toEqual([]);
  });

  it("encodes UTF-8 mouse reports across the ASCII coordinate limit", () => {
    core.mouseSgr = () => false;
    core.mouseEncoding = () => "utf8";
    core.getCols = () => 160;
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 1600, height: 400 }),
    });
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 1005,
        clientY: 35,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 1, clientX: 1015, clientY: 35 }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", { button: 0, clientX: 1015, clientY: 35 }),
    );
    container.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, clientX: 1015, clientY: 35 }),
    );

    expect(received).toEqual([
      `\x1b[M${String.fromCodePoint(32, 132, 33)}`,
      `\x1b[M${String.fromCodePoint(64, 133, 33)}`,
      `\x1b[M${String.fromCodePoint(35, 133, 33)}`,
      `\x1b[M${String.fromCodePoint(97, 133, 33)}`,
    ]);
    expect(Array.from(new TextEncoder().encode(received[0]))).toEqual([
      27, 91, 77, 32, 194, 132, 33,
    ]);
  });

  it("encodes urxvt press, drag, release, and wheel as decimal CSI", () => {
    core.mouseSgr = () => false;
    core.mouseEncoding = () => "urxvt";
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
    container.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, clientX: 105, clientY: 75 }),
    );

    expect(received).toEqual([
      "\x1b[32;8;4M",
      "\x1b[64;10;5M",
      "\x1b[35;10;5M",
      "\x1b[97;10;5M",
    ]);
  });

  it("encodes SGR pixel press, drag, release, and wheel in CSS pixels", () => {
    core.mouseSgr = () => false;
    core.mouseEncoding = () => "sgr-pixels";
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 85.25,
        clientY: 65.75,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 86.25,
        clientY: 66.75,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        button: 0,
        clientX: 86.25,
        clientY: 66.75,
      }),
    );
    container.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        clientX: 86.25,
        clientY: 66.75,
      }),
    );

    expect(received).toEqual([
      "\x1b[<0;76;34M",
      "\x1b[<32;77;35M",
      "\x1b[<0;77;35m",
      "\x1b[<65;77;35M",
    ]);
  });

  it("reports mode 1003 motion once per pixel, including within a cell", () => {
    core.mouseTracking = () => 1003;
    core.mouseEncoding = () => "sgr-pixels";
    core.mouseSgr = () => false;
    for (const x of [85.25, 85.75, 86.25]) {
      container.dispatchEvent(
        new MouseEvent("mousemove", { clientX: x, clientY: 65.25 }),
      );
    }

    expect(received).toEqual(["\x1b[<35;76;34M", "\x1b[<35;77;34M"]);
  });

  it("reports unpressed pointer motion once per cell in mode 1003", () => {
    core.mouseTracking = () => 1003;
    const move = (x: number, y: number, shiftKey = false) => {
      const event = new MouseEvent("mousemove", {
        clientX: x,
        clientY: y,
        shiftKey,
        cancelable: true,
      });
      container.dispatchEvent(event);
      return event;
    };

    expect(move(25, 35).defaultPrevented).toBe(true);
    move(26, 36);
    move(35, 35);
    move(35, 35, true);
    move(35, 35);
    move(9, 35);
    move(35, 35);

    expect(received).toEqual([
      "\x1b[<35;2;1M",
      "\x1b[<35;3;1M",
      "\x1b[<35;3;1M",
      "\x1b[<35;3;1M",
    ]);
  });

  it("keeps unpressed motion disabled in modes 1000 and 1002", () => {
    const move = () =>
      container.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 25, clientY: 35 }),
      );
    core.mouseTracking = () => 1000;
    move();
    core.mouseTracking = () => 1002;
    move();
    expect(received).toEqual([]);

    core.mouseTracking = () => 1003;
    move();
    expect(received).toEqual(["\x1b[<35;2;1M"]);

    core.mouseTracking = () => 0;
    move();
    core.mouseTracking = () => 1003;
    move();
    expect(received).toEqual(["\x1b[<35;2;1M", "\x1b[<35;2;1M"]);
  });

  it("reports button motion in mode 1003 without duplicating bubbling moves", () => {
    core.mouseTracking = () => 1003;
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 25,
        clientY: 35,
      }),
    );
    container.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        buttons: 1,
        clientX: 35,
        clientY: 35,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        button: 0,
        buttons: 0,
        clientX: 35,
        clientY: 35,
      }),
    );

    expect(received).toEqual(["\x1b[<0;2;1M", "\x1b[<32;3;1M", "\x1b[<0;3;1m"]);
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

  it("leaves clicks and wheel events on scrollback rows to the browser", () => {
    const historyRow = document.createElement("div");
    historyRow.className = "term-row term-scrollback-row";
    const liveRow = document.createElement("div");
    liveRow.className = "term-row";
    Object.defineProperty(liveRow, "getBoundingClientRect", {
      value: () => ({ left: 10, top: 420, width: 800, height: 10 }),
    });
    container.append(historyRow, liveRow);

    const press = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: 105,
      clientY: 75,
    });
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
      clientX: 105,
      clientY: 75,
    });
    historyRow.dispatchEvent(press);
    historyRow.dispatchEvent(wheel);

    expect(received).toEqual([]);
    expect(press.defaultPrevented).toBe(false);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it("leaves the wheel with scrollback until the terminal is at the bottom", () => {
    Object.defineProperties(container, {
      clientHeight: { value: 400, configurable: true },
      scrollHeight: { value: 800, configurable: true },
    });
    container.scrollTop = 100;
    const wheel = () =>
      new WheelEvent("wheel", {
        cancelable: true,
        deltaY: 100,
        clientX: 105,
        clientY: 75,
      });

    const historyWheel = wheel();
    container.dispatchEvent(historyWheel);
    expect(received).toEqual([]);
    expect(historyWheel.defaultPrevented).toBe(false);

    container.scrollTop = 400;
    const liveWheel = wheel();
    container.dispatchEvent(liveWheel);
    expect(received).toEqual(["\x1b[<65;10;5M"]);
    expect(liveWheel.defaultPrevented).toBe(true);
  });

  it("scrolls history with Shift+wheel instead of reporting to the application", () => {
    Object.defineProperties(container, {
      clientHeight: { value: 400, configurable: true },
      scrollHeight: { value: 800, configurable: true },
    });
    container.scrollTop = 400;
    const wheel = new WheelEvent("wheel", {
      cancelable: true,
      shiftKey: true,
      deltaY: -120,
      clientX: 105,
      clientY: 75,
    });
    container.dispatchEvent(wheel);

    expect(container.scrollTop).toBe(280);
    expect(received).toEqual([]);
    expect(wheel.defaultPrevented).toBe(true);

    const horizontalWheel = new WheelEvent("wheel", {
      cancelable: true,
      shiftKey: true,
      deltaX: -40,
      deltaY: -1,
      clientX: 105,
      clientY: 75,
    });
    container.dispatchEvent(horizontalWheel);
    expect(container.scrollTop).toBe(240);
    expect(received).toEqual([]);
    expect(horizontalWheel.defaultPrevented).toBe(true);
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
        clientY: 35,
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
