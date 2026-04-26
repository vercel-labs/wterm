import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

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

async function mountTerminal(
  props: Record<string, any> = {},
  listeners: Record<string, any> = {},
) {
  const Terminal = (await import("../Terminal.js")).default;
  return mount(Terminal, { props, attrs: listeners });
}

describe("Terminal component", () => {
  beforeEach(() => {
    lastWTermInstance = null;
    vi.clearAllMocks();
  });

  it("renders a div with terminal role and a11y attrs", async () => {
    const wrapper = await mountTerminal();
    const el = wrapper.get("[role='textbox']");
    expect(el.attributes("aria-label")).toBe("Terminal");
    expect(el.attributes("aria-roledescription")).toBe("terminal");
    expect(el.attributes("aria-multiline")).toBe("true");
  });

  it("applies class from attribute fallthrough", async () => {
    const wrapper = await mountTerminal({}, { class: "custom" });
    expect(wrapper.classes()).toContain("custom");
    expect(wrapper.classes()).toContain("wterm");
  });

  it("applies theme class", async () => {
    const wrapper = await mountTerminal({ theme: "dark" });
    expect(wrapper.classes()).toContain("theme-dark");
  });

  it("creates WTerm instance on mount", async () => {
    const { WTerm } = await import("@wterm/dom");
    await mountTerminal();
    expect(WTerm).toHaveBeenCalled();
  });

  it("calls init on mount", async () => {
    await mountTerminal();
    await flushPromises();
    expect(lastWTermInstance).not.toBeNull();
    expect(lastWTermInstance.init).toHaveBeenCalled();
  });

  it("emits ready after init", async () => {
    const wrapper = await mountTerminal();
    await flushPromises();
    expect(wrapper.emitted("ready")).toBeTruthy();
    expect(wrapper.emitted("ready")![0][0]).toBe(lastWTermInstance);
  });

  it("emits error on init failure", async () => {
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

    const wrapper = await mountTerminal();
    await flushPromises();
    expect(wrapper.emitted("error")).toBeTruthy();
    expect(wrapper.emitted("error")![0][0]).toBeInstanceOf(Error);
  });

  it("calls destroy on unmount", async () => {
    const wrapper = await mountTerminal();
    await flushPromises();
    const instance = lastWTermInstance;
    wrapper.unmount();
    expect(instance.destroy).toHaveBeenCalled();
  });

  it("exposes imperative handle (write/resize/focus/instance)", async () => {
    const wrapper = await mountTerminal();
    await flushPromises();

    const vm: any = wrapper.vm;
    expect(typeof vm.write).toBe("function");
    expect(typeof vm.resize).toBe("function");
    expect(typeof vm.focus).toBe("function");
    expect(vm.instance).toBe(lastWTermInstance);
  });

  it("delegates write through imperative handle", async () => {
    const wrapper = await mountTerminal();
    await flushPromises();
    (wrapper.vm as any).write("test data");
    expect(lastWTermInstance.write).toHaveBeenCalledWith("test data");
  });

  it("delegates resize through imperative handle", async () => {
    const wrapper = await mountTerminal();
    await flushPromises();
    (wrapper.vm as any).resize(120, 40);
    expect(lastWTermInstance.resize).toHaveBeenCalledWith(120, 40);
  });

  it("delegates focus through imperative handle", async () => {
    const wrapper = await mountTerminal();
    await flushPromises();
    (wrapper.vm as any).focus();
    expect(lastWTermInstance.focus).toHaveBeenCalled();
  });

  it("syncs cols/rows on prop change", async () => {
    const wrapper = await mountTerminal({ cols: 80, rows: 24 });
    await flushPromises();
    await wrapper.setProps({ cols: 120, rows: 40 });
    await nextTick();
    expect(lastWTermInstance.resize).toHaveBeenCalledWith(120, 40);
  });

  it("toggles cursor-blink class on prop change", async () => {
    const wrapper = await mountTerminal({ cursorBlink: false });
    await flushPromises();
    await wrapper.setProps({ cursorBlink: true });
    await nextTick();
    expect(lastWTermInstance.element.classList.contains("cursor-blink")).toBe(
      true,
    );
    await wrapper.setProps({ cursorBlink: false });
    await nextTick();
    expect(lastWTermInstance.element.classList.contains("cursor-blink")).toBe(
      false,
    );
  });

  it("emits data when WTerm onData fires", async () => {
    const onData = vi.fn();
    const wrapper = await mountTerminal({}, { onData });
    await flushPromises();
    lastWTermInstance.onData("hello");
    expect(wrapper.emitted("data")).toBeTruthy();
    expect(wrapper.emitted("data")![0]).toEqual(["hello"]);
  });

  it("does not set onData on WTerm when no @data listener is provided", async () => {
    await mountTerminal();
    await flushPromises();
    expect(lastWTermInstance.onData).toBeNull();
  });

  it("sets onData on WTerm when @data listener is provided", async () => {
    const onData = vi.fn();
    await mountTerminal({}, { onData });
    await flushPromises();
    expect(lastWTermInstance.onData).toBeTypeOf("function");
  });

  it("passes debug option to WTerm", async () => {
    const { WTerm } = await import("@wterm/dom");
    await mountTerminal({ debug: true });
    await flushPromises();
    expect(WTerm).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ debug: true }),
    );
  });

  it("emits title when WTerm onTitle fires", async () => {
    const wrapper = await mountTerminal();
    await flushPromises();
    lastWTermInstance.onTitle("my title");
    expect(wrapper.emitted("title")![0]).toEqual(["my title"]);
  });

  it("emits resize when WTerm onResize fires", async () => {
    const wrapper = await mountTerminal();
    await flushPromises();
    lastWTermInstance.onResize(100, 30);
    expect(wrapper.emitted("resize")![0]).toEqual([100, 30]);
  });
});
