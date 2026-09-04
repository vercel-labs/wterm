import { cleanup, render } from "@testing-library/svelte";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tick } from "svelte";
import Terminal from "../lib/Terminal.svelte";

let lastWTermInstance: any = null;

vi.mock("@wterm/dom", () => {
  const mockWTerm = vi.fn().mockImplementation(function (
    this: any,
    element: HTMLElement,
    options: any,
  ) {
    this.element = element;
    this.bridge = null;
    this.cols = options?.cols ?? 80;
    this.rows = options?.rows ?? 24;
    this.onData = options?.onData ?? null;
    this.onTitle = options?.onTitle ?? null;
    this.onResize = options?.onResize ?? null;
    this.autoResize = options?.autoResize !== false;
    this.write = vi.fn();
    this.resize = vi.fn((cols: number, rows: number) => {
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

  return {
    WTerm: mockWTerm,
    Renderer: vi.fn(),
    InputHandler: vi.fn(),
  };
});

describe("Terminal component", () => {
  beforeEach(() => {
    lastWTermInstance = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders an accessible terminal element", () => {
    const { getByRole } = render(Terminal);
    const element = getByRole("textbox");

    expect(element.getAttribute("aria-label")).toBe("Terminal");
    expect(element.getAttribute("aria-multiline")).toBe("true");
    expect(element.getAttribute("aria-roledescription")).toBe("terminal");
  });

  it("forwards classes and styles", () => {
    const { getByRole } = render(Terminal, {
      props: {
        class: "custom",
        style: "background: purple",
        theme: "dark",
      },
    });
    const element = getByRole("textbox");

    expect(element.classList.contains("wterm")).toBe(true);
    expect(element.classList.contains("custom")).toBe(true);
    expect(element.classList.contains("theme-dark")).toBe(true);
    expect(element.style.background).toBe("purple");
    expect(element.style.height).toBe("432px");
  });

  it("creates and initializes WTerm on mount", async () => {
    const { WTerm } = await import("@wterm/dom");
    render(Terminal);
    await Promise.resolve();
    await tick();

    expect(WTerm).toHaveBeenCalled();
    expect(lastWTermInstance.init).toHaveBeenCalled();
  });

  it("passes terminal options to WTerm", async () => {
    const { WTerm } = await import("@wterm/dom");
    render(Terminal, {
      props: {
        cols: 120,
        rows: 40,
        autoResize: true,
        maxImageWidth: 800,
        maxImageHeight: 600,
        debug: true,
      },
    });

    expect(WTerm).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        cols: 120,
        rows: 40,
        autoResize: true,
        maxImageWidth: 800,
        maxImageHeight: 600,
        debug: true,
      }),
    );
  });

  it("calls the ready callback", async () => {
    const onReady = vi.fn();
    render(Terminal, { props: { onReady } });

    await Promise.resolve();

    expect(onReady).toHaveBeenCalledWith(lastWTermInstance);
  });

  it("forwards input through onData", async () => {
    const onData = vi.fn();
    render(Terminal, { props: { onData } });
    await Promise.resolve();

    lastWTermInstance.onData("hello");

    expect(onData).toHaveBeenCalledWith("hello");
  });

  it("updates the WTerm input handler when onData changes", async () => {
    const result = render(Terminal);
    await Promise.resolve();

    expect(lastWTermInstance.onData).toBeNull();

    const onData = vi.fn();
    await result.rerender({ onData });

    expect(lastWTermInstance.onData).toBeTypeOf("function");
    lastWTermInstance.onData("hello");
    expect(onData).toHaveBeenCalledWith("hello");

    await result.rerender({ onData: undefined });
    expect(lastWTermInstance.onData).toBeNull();
  });

  it("applies callback changes made while initialization is pending", async () => {
    const { WTerm } = await import("@wterm/dom");
    let resolveInit!: () => void;
    const pendingInit = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });

    (WTerm as any).mockImplementationOnce(function (
      this: any,
      element: HTMLElement,
      options: any,
    ) {
      this.element = element;
      this.bridge = null;
      this.cols = options?.cols ?? 80;
      this.rows = options?.rows ?? 24;
      this.onData = options?.onData ?? null;
      this.onTitle = options?.onTitle ?? null;
      this.onResize = options?.onResize ?? null;
      this.write = vi.fn();
      this.resize = vi.fn();
      this.focus = vi.fn();
      this.destroy = vi.fn();
      this.init = vi.fn(() =>
        pendingInit.then(() => {
          this.bridge = {};
          return this;
        }),
      );
      lastWTermInstance = this;
    });

    const result = render(Terminal);
    const onData = vi.fn();
    await result.rerender({ onData });

    expect(lastWTermInstance.onData).toBeNull();
    resolveInit();
    await Promise.resolve();
    await Promise.resolve();
    await tick();

    expect(lastWTermInstance.onData).toBeTypeOf("function");
    lastWTermInstance.onData("hello");
    expect(onData).toHaveBeenCalledWith("hello");
  });

  it("exposes imperative methods through bind:this", async () => {
    const { component } = render(Terminal);
    await Promise.resolve();

    (component as any).write("test data");
    (component as any).resize(120, 40);
    (component as any).focus();

    expect(lastWTermInstance.write).toHaveBeenCalledWith("test data");
    expect(lastWTermInstance.resize).toHaveBeenCalledWith(120, 40);
    expect(lastWTermInstance.focus).toHaveBeenCalled();
  });

  it("supports Svelte 5 callback-style event props", async () => {
    const ondata = vi.fn();
    const ontitle = vi.fn();
    const onresize = vi.fn();
    render(Terminal, { props: { ondata, ontitle, onresize } });
    await Promise.resolve();

    lastWTermInstance.onData("hello");
    lastWTermInstance.onTitle("my title");
    lastWTermInstance.onResize(100, 30);

    expect(ondata).toHaveBeenCalledWith("hello");
    expect(ontitle).toHaveBeenCalledWith("my title");
    expect(onresize).toHaveBeenCalledWith(100, 30);
  });

  it("forwards title and resize callbacks", async () => {
    const onTitle = vi.fn();
    const onResize = vi.fn();
    render(Terminal, { props: { onTitle, onResize } });
    await Promise.resolve();

    lastWTermInstance.onTitle("my title");
    lastWTermInstance.onResize(100, 30);

    expect(onTitle).toHaveBeenCalledWith("my title");
    expect(onResize).toHaveBeenCalledWith(100, 30);
  });

  it("syncs dimensions and cursor blinking when props change", async () => {
    const result = render(Terminal, {
      props: { cols: 80, rows: 24, cursorBlink: false },
    });
    await Promise.resolve();

    await result.rerender({ cols: 120, rows: 40, cursorBlink: true });

    expect(lastWTermInstance.resize).toHaveBeenCalledWith(120, 40);
    expect(lastWTermInstance.element.classList.contains("cursor-blink")).toBe(
      true,
    );
  });

  it("destroys WTerm on unmount", async () => {
    const { unmount } = render(Terminal);
    await Promise.resolve();
    const instance = lastWTermInstance;

    unmount();

    expect(instance.destroy).toHaveBeenCalled();
  });

  it("does not call ready after unmount while initialization is pending", async () => {
    const { WTerm } = await import("@wterm/dom");
    let resolveInit!: () => void;
    const pendingInit = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });

    (WTerm as any).mockImplementationOnce(function (
      this: any,
      element: HTMLElement,
      options: any,
    ) {
      this.element = element;
      this.bridge = null;
      this.cols = options?.cols ?? 80;
      this.rows = options?.rows ?? 24;
      this.onData = options?.onData ?? null;
      this.onTitle = options?.onTitle ?? null;
      this.onResize = options?.onResize ?? null;
      this.write = vi.fn();
      this.resize = vi.fn();
      this.focus = vi.fn();
      this.destroy = vi.fn();
      this.init = vi.fn(() =>
        pendingInit.then(() => {
          this.bridge = {};
          return this;
        }),
      );
      lastWTermInstance = this;
    });

    const onReady = vi.fn();
    const { unmount } = render(Terminal, { props: { onReady } });
    unmount();
    resolveInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(onReady).not.toHaveBeenCalled();
  });

  it("allows overriding the default accessibility attributes", () => {
    const { container } = render(Terminal, {
      props: {
        role: "application",
        "aria-label": "Shell",
        "aria-multiline": "false",
        "aria-roledescription": "shell",
      } as any,
    });
    const element = container.querySelector(".wterm")!;

    expect(element.getAttribute("role")).toBe("application");
    expect(element.getAttribute("aria-label")).toBe("Shell");
    expect(element.getAttribute("aria-multiline")).toBe("false");
    expect(element.getAttribute("aria-roledescription")).toBe("shell");
  });

  it("calls the error callback", async () => {
    const { WTerm } = await import("@wterm/dom");
    (WTerm as any).mockImplementationOnce(function (
      this: any,
      element: HTMLElement,
    ) {
      this.element = element;
      this.bridge = null;
      this.cols = 80;
      this.rows = 24;
      this.onData = null;
      this.onTitle = null;
      this.onResize = null;
      this.write = vi.fn();
      this.resize = vi.fn();
      this.focus = vi.fn();
      this.destroy = vi.fn();
      this.init = vi.fn().mockRejectedValue(new Error("WASM failed"));
      lastWTermInstance = this;
    });

    const onError = vi.fn();
    render(Terminal, { props: { onError } });
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
