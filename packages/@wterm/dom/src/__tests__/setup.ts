import { vi } from "vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
}

const _origGetComputedStyle =
  typeof window !== "undefined" ? window.getComputedStyle.bind(window) : null;

vi.stubGlobal("getComputedStyle", (el: Element) => {
  const orig = _origGetComputedStyle ? _origGetComputedStyle(el) : {};
  return {
    ...orig,
    getPropertyValue: (prop: string) => {
      if (prop === "--term-row-height") return "17";
      return "";
    },
    paddingTop: "12",
    paddingBottom: "12",
    borderTopWidth: "0",
    borderBottomWidth: "0",
    boxSizing: "content-box",
  };
});
