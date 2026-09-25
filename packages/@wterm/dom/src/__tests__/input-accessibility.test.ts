import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputHandler } from "../input.js";

describe("terminal input accessibility", () => {
  let host: HTMLDivElement;
  let handler: InputHandler;
  let input: HTMLTextAreaElement;

  function init() {
    handler = new InputHandler(
      host,
      () => {},
      () => null,
    );
    input = host.querySelector("textarea")!;
  }
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => {
    handler.destroy();
    host.remove();
  });

  it("names the actual editable control and gives output a separate group", () => {
    init();
    handler.focus();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-label")).toBe("Terminal");
    expect(input.hasAttribute("aria-hidden")).toBe(false);
    expect(input.tabIndex).toBe(0);
    expect(host.getAttribute("role")).toBe("group");
  });

  it("follows changing labels and descriptions without replacing input or stealing focus", async () => {
    host.setAttribute("aria-label", "Build shell");
    host.setAttribute("aria-describedby", "help");
    init();
    expect(input.getAttribute("aria-label")).toBe("Build shell");
    expect(input.getAttribute("aria-describedby")).toBe("help");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    host.setAttribute("aria-label", "Test shell");
    host.setAttribute("aria-labelledby", "heading subtitle");
    host.setAttribute("aria-description", "Commands run locally");
    await Promise.resolve();
    expect(input.getAttribute("aria-label")).toBe("Test shell");
    expect(input.getAttribute("aria-labelledby")).toBe("heading subtitle");
    expect(input.getAttribute("aria-description")).toBe("Commands run locally");
    expect(document.activeElement).toBe(outside);
    for (const name of [
      "aria-label",
      "aria-labelledby",
      "aria-describedby",
      "aria-description",
    ])
      host.removeAttribute(name);
    await Promise.resolve();
    expect(host.querySelector("textarea")).toBe(input);
    expect(input.getAttribute("aria-label")).toBe("Terminal");
    expect(input.hasAttribute("aria-labelledby")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(input.hasAttribute("aria-description")).toBe(false);
    outside.remove();
  });

  it("moves tabIndex to input and handles framework changes even when the host already has -1", async () => {
    host.tabIndex = 3;
    init();
    expect(input.tabIndex).toBe(3);
    expect(host.tabIndex).toBe(-1);
    host.tabIndex = -1;
    await Promise.resolve();
    expect(input.tabIndex).toBe(-1);
    host.tabIndex = 0;
    await Promise.resolve();
    expect(input.tabIndex).toBe(0);
    expect(host.tabIndex).toBe(-1);
    // A label-only update must not reinterpret our host normalization.
    host.setAttribute("aria-label", "Renamed");
    await Promise.resolve();
    expect(input.tabIndex).toBe(0);
    host.removeAttribute("tabindex");
    await Promise.resolve();
    expect(input.tabIndex).toBe(0);
    expect(host.hasAttribute("tabindex")).toBe(false);
  });

  it("restores the latest host tabIndex and releases observers on destruction", async () => {
    host.tabIndex = 2;
    host.setAttribute("role", "region");
    init();
    host.tabIndex = 4;
    // Teardown may happen before the attribute observer delivers.
    handler.destroy();
    expect(host.tabIndex).toBe(4);
    expect(host.getAttribute("role")).toBe("region");
    host.setAttribute("aria-label", "After teardown");
    host.tabIndex = 5;
    await Promise.resolve();
    expect(input.getAttribute("aria-label")).toBe("Terminal");
    expect(host.tabIndex).toBe(5);
    init();
    expect(input.tabIndex).toBe(5);
    expect(input.getAttribute("aria-label")).toBe("After teardown");
  });

  it("removes only the default role it added", () => {
    init();
    handler.destroy();
    expect(host.hasAttribute("role")).toBe(false);
    init();
    host.setAttribute("role", "region");
    handler.destroy();
    expect(host.getAttribute("role")).toBe("region");
  });
});
