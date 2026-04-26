import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, unmount, tick } from "svelte";
import Terminal from "../Terminal.svelte";
let lastWTermInstance = null;
vi.mock("@wterm/dom", () => {
    const mockWTerm = vi.fn().mockImplementation(function (el, options) {
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
function mountTerminal(props = {}) {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(Terminal, { target, props });
    return { component, target };
}
async function flushPromises() {
    await Promise.resolve();
    await tick();
}
describe("Terminal component", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        lastWTermInstance = null;
        vi.clearAllMocks();
    });
    it("renders a div with terminal role and a11y attrs", () => {
        const { target } = mountTerminal();
        const el = target.querySelector("[role='textbox']");
        expect(el?.getAttribute("aria-label")).toBe("Terminal");
        expect(el?.getAttribute("aria-roledescription")).toBe("terminal");
        expect(el?.getAttribute("aria-multiline")).toBe("true");
    });
    it("applies class props and theme class", () => {
        const { target } = mountTerminal({ class: "custom", theme: "dark" });
        const el = target.querySelector(".wterm");
        expect(el?.classList.contains("custom")).toBe(true);
        expect(el?.classList.contains("theme-dark")).toBe(true);
    });
    it("creates WTerm instance on mount", async () => {
        const { WTerm } = await import("@wterm/dom");
        mountTerminal();
        await tick();
        expect(WTerm).toHaveBeenCalled();
    });
    it("calls init and onReady on mount", async () => {
        const onReady = vi.fn();
        mountTerminal({ onReady });
        await flushPromises();
        expect(lastWTermInstance.init).toHaveBeenCalled();
        expect(onReady).toHaveBeenCalledWith(lastWTermInstance);
    });
    it("calls onError on init failure", async () => {
        const { WTerm } = await import("@wterm/dom");
        WTerm.mockImplementationOnce(function (el) {
            this.element = el;
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
        mountTerminal({ onError });
        await flushPromises();
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
    it("calls destroy on unmount", async () => {
        const { component } = mountTerminal();
        await flushPromises();
        const instance = lastWTermInstance;
        unmount(component);
        expect(instance.destroy).toHaveBeenCalled();
    });
    it("exposes imperative API through bind:this", async () => {
        const { component } = mountTerminal();
        await flushPromises();
        expect(typeof component.write).toBe("function");
        expect(typeof component.resize).toBe("function");
        expect(typeof component.focus).toBe("function");
        expect(component.instance()).toBe(lastWTermInstance);
    });
    it("delegates imperative methods", async () => {
        const { component } = mountTerminal();
        await flushPromises();
        component.write("test data");
        component.resize(120, 40);
        component.focus();
        expect(lastWTermInstance.write).toHaveBeenCalledWith("test data");
        expect(lastWTermInstance.resize).toHaveBeenCalledWith(120, 40);
        expect(lastWTermInstance.focus).toHaveBeenCalled();
    });
    it("wires callback props to WTerm callbacks", async () => {
        const onData = vi.fn();
        const onTitle = vi.fn();
        const onResize = vi.fn();
        mountTerminal({ onData, onTitle, onResize });
        await flushPromises();
        lastWTermInstance.onData("hello");
        lastWTermInstance.onTitle("my title");
        lastWTermInstance.onResize(100, 30);
        expect(onData).toHaveBeenCalledWith("hello");
        expect(onTitle).toHaveBeenCalledWith("my title");
        expect(onResize).toHaveBeenCalledWith(100, 30);
    });
    it("does not set onData on WTerm when no onData prop is provided", async () => {
        mountTerminal();
        await flushPromises();
        expect(lastWTermInstance.onData).toBeNull();
    });
    it("passes debug option to WTerm", async () => {
        const { WTerm } = await import("@wterm/dom");
        mountTerminal({ debug: true });
        await flushPromises();
        expect(WTerm).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ debug: true }));
    });
});
