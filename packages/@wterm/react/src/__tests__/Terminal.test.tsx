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
    this.onBinary = options?.onBinary ?? null;
    this.onTitle = options?.onTitle ?? null;
    this.onBell = options?.onBell ?? null;
    this.onResize = options?.onResize ?? null;
    this.autoResize = options?.autoResize !== false;
    this.write = vi.fn();
    this.resize = vi.fn();
    this.focus = vi.fn();
    this.setOutputAnnouncements = vi.fn();
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
    const el = screen.getByRole("group");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-label", "Terminal");
    expect(el).toHaveAttribute("aria-roledescription", "terminal");
  });

  it("applies className prop", async () => {
    const { container } = await renderTerminal({ className: "custom" });
    const el = container.querySelector("[role='group']")!;
    expect(el.className).toContain("custom");
  });

  it("toggles output announcements without replacing the terminal", async () => {
    const Terminal = (await import("../Terminal.js")).default;
    const { rerender } = render(<Terminal announceOutput />);
    const instance = lastWTermInstance;
    expect(instance.setOutputAnnouncements).toHaveBeenLastCalledWith(true);
    rerender(<Terminal announceOutput={false} />);
    expect(instance.setOutputAnnouncements).toHaveBeenLastCalledWith(false);
    expect(lastWTermInstance).toBe(instance);
    expect(instance.destroy).not.toHaveBeenCalled();
    expect(instance.element.hasAttribute("announceOutput")).toBe(false);
  });

  it("updates host input labels and tab order without restarting the terminal", async () => {
    const Terminal = (await import("../Terminal.js")).default;
    const { rerender } = render(
      <Terminal
        aria-label="Build shell"
        aria-describedby="help"
        tabIndex={0}
      />,
    );
    const host = screen.getByRole("group", { name: "Build shell" });
    const instance = lastWTermInstance;
    expect(host).not.toHaveAttribute("aria-multiline");
    rerender(
      <Terminal
        aria-label="Test shell"
        aria-labelledby="heading"
        tabIndex={-1}
      />,
    );
    expect(host).toHaveAttribute("aria-label", "Test shell");
    expect(host).toHaveAttribute("aria-labelledby", "heading");
    expect(host).not.toHaveAttribute("aria-describedby");
    expect(host).toHaveAttribute("tabindex", "-1");
    expect(lastWTermInstance).toBe(instance);
    expect(instance.destroy).not.toHaveBeenCalled();
  });

  it("applies theme class", async () => {
    const { container } = await renderTerminal({ theme: "dark" });
    const el = container.querySelector("[role='group']")!;
    expect(el.className).toContain("theme-dark");
  });

  it("lets cursor blink props switch between forced and application-controlled behavior", async () => {
    const Terminal = (await import("../Terminal.js")).default;
    const { rerender, container } = render(<Terminal />);
    await act(async () => {});
    const element = container.querySelector('[role="group"]')!;
    expect(element).not.toHaveClass("cursor-blink", "cursor-steady");
    element.classList.add("focused", "has-scrollback");
    rerender(<Terminal cursorBlink />);
    expect(element).toHaveClass("cursor-blink");
    expect(element).toHaveClass("focused", "has-scrollback");
    rerender(<Terminal cursorBlink={false} />);
    expect(element).toHaveClass("cursor-steady", "focused", "has-scrollback");
    expect(element).not.toHaveClass("cursor-blink");
    rerender(<Terminal />);
    expect(element).not.toHaveClass("cursor-blink", "cursor-steady");
    expect(element).toHaveClass("focused", "has-scrollback");
    expect(lastWTermInstance.destroy).not.toHaveBeenCalled();
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

  it("forwards raw mouse bytes and follows onBinary prop changes", async () => {
    const Terminal = (await import("../Terminal.js")).default;
    const first = vi.fn();
    const next = vi.fn();
    const bytes = Uint8Array.of(27, 91, 77, 32, 132, 33);
    const { rerender } = render(<Terminal onBinary={first} />);
    await act(async () => {});

    lastWTermInstance.onBinary(bytes);
    expect(first).toHaveBeenCalledWith(bytes);

    rerender(<Terminal onBinary={next} />);
    lastWTermInstance.onBinary(bytes);
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(bytes);

    rerender(<Terminal />);
    expect(lastWTermInstance.onBinary).toBeNull();
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
      this.setOutputAnnouncements = vi.fn();
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

  it("does not repeat a capped size request on unrelated renders", async () => {
    const Terminal = (await import("../Terminal.js")).default;
    const { rerender } = render(<Terminal cols={320} rows={40} />);
    await act(async () => {});
    lastWTermInstance.cols = 256;

    rerender(<Terminal cols={320} rows={40} className="updated" />);
    expect(lastWTermInstance.resize).not.toHaveBeenCalled();

    rerender(<Terminal cols={300} rows={40} className="updated" />);
    expect(lastWTermInstance.resize).toHaveBeenCalledOnce();
    expect(lastWTermInstance.resize).toHaveBeenCalledWith(300, 40);

    rerender(<Terminal cols={300} rows={40} className="again" />);
    expect(lastWTermInstance.resize).toHaveBeenCalledOnce();
  });

  it("delegates focus through imperative handle", async () => {
    const ref = createRef<TerminalHandle>();
    const Terminal = (await import("../Terminal.js")).default;
    render(<Terminal ref={ref} />);
    await act(async () => {});

    ref.current!.focus();
    expect(lastWTermInstance.focus).toHaveBeenCalled();
  });

  it("forwards bell counts to the latest callback", async () => {
    const Terminal = (await import("../Terminal.js")).default;
    const first = vi.fn();
    const next = vi.fn();
    const { rerender } = render(<Terminal onBell={first} />);
    await act(async () => {});

    lastWTermInstance.onBell(2);
    expect(first).toHaveBeenCalledWith(2);

    rerender(<Terminal onBell={next} />);
    lastWTermInstance.onBell(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(1);
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
