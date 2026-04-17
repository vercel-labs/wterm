import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalController } from "../controller.js";
import { wterm } from "../action.js";

let lastWTermInstance: any = null;
const { mockWTerm } = vi.hoisted(() => ({
  mockWTerm: vi.fn(),
}));

vi.mock("@wterm/dom", () => {
  return {
    WTerm: mockWTerm,
  };
});

mockWTerm.mockImplementation(function (
  this: any,
  el: HTMLElement,
  options: any,
) {
  this.element = el;
  this.bridge = null;
  this.cols = options?.cols ?? 80;
  this.rows = options?.rows ?? 24;
  this.onData = options?.onData ?? null;
  this.onTitle = options?.onTitle ?? null;
  this.onResize = options?.onResize ?? null;
  this.autoResize = options?.autoResize !== false;
  this.write = vi.fn();
  this.resize = vi.fn().mockImplementation((cols: number, rows: number) => {
    this.cols = cols;
    this.rows = rows;
  });
  this.focus = vi.fn();
  this.destroy = vi.fn();
  this.init = vi.fn().mockImplementation(async () => {
    this.bridge = {};
    return this;
  });
  lastWTermInstance = this;
});

describe("wterm action", () => {
  let element: HTMLDivElement;

  type ActionResult = Extract<ReturnType<typeof wterm>, object>;
  type RequiredActionReturn = {
    update: Exclude<ActionResult["update"], undefined>;
    destroy: Exclude<ActionResult["destroy"], undefined>;
  };

  function requireActionReturn(result: ReturnType<typeof wterm>) {
    if (!result?.update || !result.destroy) {
      throw new Error("Expected the wterm action to return update/destroy handlers");
    }

    return result as RequiredActionReturn;
  }

  beforeEach(() => {
    lastWTermInstance = null;
    vi.clearAllMocks();
    element = document.createElement("div");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("creates and initializes a WTerm instance", async () => {
    const action = requireActionReturn(wterm(element, {}));

    await flush();

    expect(mockWTerm).toHaveBeenCalled();
    expect(lastWTermInstance.init).toHaveBeenCalled();
    action.destroy();
  });

  it("applies terminal semantics, theme, and fixed height styling", () => {
    const action = requireActionReturn(wterm(element, {
      theme: "dark",
      cursorBlink: true,
      autoResize: false,
      rows: 10,
    }));

    expect(element.getAttribute("role")).toBe("textbox");
    expect(element.getAttribute("aria-label")).toBe("Terminal");
    expect(element.getAttribute("aria-roledescription")).toBe("terminal");
    expect(element.classList.contains("theme-dark")).toBe(true);
    expect(element.classList.contains("cursor-blink")).toBe(true);
    expect(element.style.height).toBe("194px");

    action.destroy();
  });

  it("calls onReady after initialization", async () => {
    const onReady = vi.fn();
    const action = requireActionReturn(wterm(element, { onReady }));

    await flush();

    expect(onReady).toHaveBeenCalledWith(lastWTermInstance);
    action.destroy();
  });

  it("calls onError when initialization fails", async () => {
    mockWTerm.mockImplementationOnce(function (this: any, el: HTMLElement) {
      this.element = el;
      this.bridge = null;
      this.cols = 80;
      this.rows = 24;
      this.onData = null;
      this.onTitle = null;
      this.onResize = null;
      this.autoResize = true;
      this.write = vi.fn();
      this.resize = vi.fn();
      this.focus = vi.fn();
      this.destroy = vi.fn();
      this.init = vi.fn().mockRejectedValue(new Error("WASM failed"));
      lastWTermInstance = this;
    });

    const onError = vi.fn();
    wterm(element, { onError });
    await flush();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("updates the existing terminal when cols and rows change", async () => {
    const action = requireActionReturn(wterm(element, {
      autoResize: false,
      cols: 80,
      rows: 24,
    }));
    await flush();

    const instance = lastWTermInstance;
    action.update({ autoResize: false, cols: 120, rows: 40 });

    expect(instance.resize).toHaveBeenCalledWith(120, 40);
    action.destroy();
  });

  it("recreates the terminal when autoResize changes", async () => {
    const action = requireActionReturn(wterm(element, { autoResize: true }));
    await flush();

    const firstInstance = lastWTermInstance;
    action.update({ autoResize: false });
    await flush();

    expect(firstInstance.destroy).toHaveBeenCalled();
    expect(lastWTermInstance).not.toBe(firstInstance);
    action.destroy();
  });

  it("controller delegates to the underlying terminal instance", async () => {
    const controller = createTerminalController();
    const action = requireActionReturn(wterm(element, { controller }));
    await flush();

    controller.write("hello");
    controller.resize(100, 30);
    controller.focus();

    expect(controller.instance).toBe(lastWTermInstance);
    expect(lastWTermInstance.write).toHaveBeenCalledWith("hello");
    expect(lastWTermInstance.resize).toHaveBeenCalledWith(100, 30);
    expect(lastWTermInstance.focus).toHaveBeenCalled();

    action.destroy();
    expect(controller.instance).toBeNull();
  });
});
