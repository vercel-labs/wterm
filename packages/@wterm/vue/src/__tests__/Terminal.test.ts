import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref as vueRef } from "vue";
import type { TerminalHandle } from "../Terminal.js";
import { useTerminal } from "../useTerminal.js";

let lastWTermInstance: any = null;
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

vi.mock("@wterm/dom", () => {
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

  async function mountTerminal(
    props: Record<string, unknown> = {},
    attrs: Record<string, unknown> = {},
  ) {
    const Terminal = (await import("../Terminal.js")).default;
    return mount(Terminal, { props, attrs });
  }

  it("renders a div with terminal role", async () => {
    const wrapper = await mountTerminal();
    const el = wrapper.get("[role='textbox']");

    expect(el.attributes("aria-label")).toBe("Terminal");
    expect(el.attributes("aria-roledescription")).toBe("terminal");
  });

  it("applies incoming classes and theme class", async () => {
    const wrapper = await mountTerminal({ theme: "dark" }, { class: "custom" });
    const el = wrapper.get("[role='textbox']");

    expect(el.classes()).toContain("custom");
    expect(el.classes()).toContain("theme-dark");
  });

  it("creates a WTerm instance on mount", async () => {
    await mountTerminal();

    expect(mockWTerm).toHaveBeenCalled();
  });

  it("calls init on mount", async () => {
    await mountTerminal();
    await flushPromises();

    expect(lastWTermInstance).not.toBeNull();
    expect(lastWTermInstance.init).toHaveBeenCalled();
  });

  it("calls onReady after init", async () => {
    const onReady = vi.fn();

    await mountTerminal({ onReady });
    await flushPromises();

    expect(onReady).toHaveBeenCalledWith(lastWTermInstance);
  });

  it("calls onError on init failure", async () => {
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
    await mountTerminal({ onError });
    await flushPromises();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("calls destroy on unmount", async () => {
    const wrapper = await mountTerminal();
    await flushPromises();
    const instance = lastWTermInstance;

    wrapper.unmount();

    expect(instance.destroy).toHaveBeenCalled();
  });

  it("exposes imperative methods through a template ref", async () => {
    const terminalRef = vueRef<TerminalHandle | null>(null);
    const Terminal = (await import("../Terminal.js")).default;

    mount(
      defineComponent({
        setup() {
          return () => h(Terminal, { ref: terminalRef });
        },
      }),
    );
    await flushPromises();

    expect(terminalRef.value).not.toBeNull();

    terminalRef.value!.write("test data");
    terminalRef.value!.resize(120, 40);
    terminalRef.value!.focus();

    expect(lastWTermInstance.write).toHaveBeenCalledWith("test data");
    expect(lastWTermInstance.resize).toHaveBeenCalledWith(120, 40);
    expect(lastWTermInstance.focus).toHaveBeenCalled();
  });
});

describe("useTerminal", () => {
  it("returns ref, attach, write, resize, and focus helpers", () => {
    const terminal = useTerminal();

    expect(terminal.ref).toBeDefined();
    expect(typeof terminal.attach).toBe("function");
    expect(typeof terminal.write).toBe("function");
    expect(typeof terminal.resize).toBe("function");
    expect(typeof terminal.focus).toBe("function");
  });

  it("delegates helpers to the exposed terminal instance", () => {
    const terminal = useTerminal();
    const handle = {
      write: vi.fn(),
      resize: vi.fn(),
      focus: vi.fn(),
      instance: null,
    } as unknown as TerminalHandle;

    terminal.attach(handle);
    terminal.write("hello");
    terminal.resize(100, 30);
    terminal.focus();

    expect(handle.write).toHaveBeenCalledWith("hello");
    expect(handle.resize).toHaveBeenCalledWith(100, 30);
    expect(handle.focus).toHaveBeenCalled();
  });
});
