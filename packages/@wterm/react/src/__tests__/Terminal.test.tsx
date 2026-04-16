import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React, { createRef } from "react";
import type { TerminalHandle } from "../Terminal.js";
import { useTerminal } from "../useTerminal.js";

let lastWTermInstance: any = null;

vi.mock("@wterm/dom", () => {
  const mockWTerm = vi.fn().mockImplementation(function (
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
    this.resize = vi.fn();
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

  async function renderTerminal(props: Record<string, any> = {}) {
    const Terminal = (await import("../Terminal.js")).default;
    return render(<Terminal {...props} />);
  }

  it("renders a div with terminal role", async () => {
    await renderTerminal();
    const el = screen.getByRole("textbox");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-label", "Terminal");
    expect(el).toHaveAttribute("aria-roledescription", "terminal");
  });

  it("applies className prop", async () => {
    const { container } = await renderTerminal({ className: "custom" });
    const el = container.querySelector("[role='textbox']")!;
    expect(el.className).toContain("custom");
  });

  it("applies theme class", async () => {
    const { container } = await renderTerminal({ theme: "dark" });
    const el = container.querySelector("[role='textbox']")!;
    expect(el.className).toContain("theme-dark");
  });

  it("creates WTerm instance on mount", async () => {
    const { WTerm } = await import("@wterm/dom");
    await renderTerminal();
    expect(WTerm).toHaveBeenCalled();
  });

  it("calls init on mount", async () => {
    await renderTerminal();
    await act(async () => {});
    expect(lastWTermInstance).not.toBeNull();
    expect(lastWTermInstance.init).toHaveBeenCalled();
  });

  it("calls onReady after init", async () => {
    const onReady = vi.fn();
    await renderTerminal({ onReady });
    await act(async () => {});
    expect(onReady).toHaveBeenCalled();
  });

  it("calls onError on init failure", async () => {
    const { WTerm } = await import("@wterm/dom");
    (WTerm as any).mockImplementationOnce(function (
      this: any,
      el: HTMLElement,
    ) {
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
    await renderTerminal({ onError });
    await act(async () => {});
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("calls destroy on unmount", async () => {
    const { unmount } = await renderTerminal();
    await act(async () => {});
    const instance = lastWTermInstance;
    unmount();
    expect(instance.destroy).toHaveBeenCalled();
  });

  it("exposes imperative handle via ref", async () => {
    const ref = createRef<TerminalHandle>();
    const Terminal = (await import("../Terminal.js")).default;
    render(<Terminal ref={ref} />);
    await act(async () => {});

    expect(ref.current).not.toBeNull();
    expect(typeof ref.current!.write).toBe("function");
    expect(typeof ref.current!.resize).toBe("function");
    expect(typeof ref.current!.focus).toBe("function");
  });

  it("delegates write through imperative handle", async () => {
    const ref = createRef<TerminalHandle>();
    const Terminal = (await import("../Terminal.js")).default;
    render(<Terminal ref={ref} />);
    await act(async () => {});

    ref.current!.write("test data");
    expect(lastWTermInstance.write).toHaveBeenCalledWith("test data");
  });

  it("delegates resize through imperative handle", async () => {
    const ref = createRef<TerminalHandle>();
    const Terminal = (await import("../Terminal.js")).default;
    render(<Terminal ref={ref} />);
    await act(async () => {});

    ref.current!.resize(120, 40);
    expect(lastWTermInstance.resize).toHaveBeenCalledWith(120, 40);
  });

  it("delegates focus through imperative handle", async () => {
    const ref = createRef<TerminalHandle>();
    const Terminal = (await import("../Terminal.js")).default;
    render(<Terminal ref={ref} />);
    await act(async () => {});

    ref.current!.focus();
    expect(lastWTermInstance.focus).toHaveBeenCalled();
  });
});

describe("useTerminal", () => {
  it("returns ref, write, resize, focus", () => {
    let result: ReturnType<typeof useTerminal> | null = null;

    function TestComponent() {
      result = useTerminal();
      return <div />;
    }

    render(<TestComponent />);
    expect(result).not.toBeNull();
    expect(result!.ref).toBeDefined();
    expect(typeof result!.write).toBe("function");
    expect(typeof result!.resize).toBe("function");
    expect(typeof result!.focus).toBe("function");
  });

  it("write is a stable callback", () => {
    const writes: Function[] = [];

    function TestComponent() {
      const { write } = useTerminal();
      writes.push(write);
      return <div />;
    }

    const { rerender } = render(<TestComponent />);
    rerender(<TestComponent />);
    expect(writes[0]).toBe(writes[1]);
  });
});
