import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markSelectionChanged, selectionMayExist } from "../selection-state.js";

describe("selection state", () => {
  let target: HTMLDivElement;
  let selection: Selection;

  beforeEach(() => {
    target = document.createElement("div");
    target.contentEditable = "true";
    target.textContent = "outside terminal";
    document.body.appendChild(target);
    selection = document.getSelection()!;
    selection.removeAllRanges();
    markSelectionChanged(document);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    selection.removeAllRanges();
    markSelectionChanged(document);
    target.remove();
  });

  it.each([
    "selectionchange",
    "pointerdown",
    "mousedown",
    "touchstart",
    "keydown",
  ])("invalidates synchronously on %s", (type) => {
    expect(selectionMayExist(document)).toBe(false);
    target.addEventListener(type, (event) => event.stopPropagation());
    (type === "selectionchange" ? document : target).dispatchEvent(
      new Event(type, { bubbles: true }),
    );
    selection.setBaseAndExtent(target.firstChild!, 0, target.firstChild!, 7);

    expect(selectionMayExist(document)).toBe(true);
    expect(selection.toString()).toBe("outside");
  });

  it("sees a programmatic selection as soon as its owner invalidates", () => {
    expect(selectionMayExist(document)).toBe(false);
    markSelectionChanged(document);
    selection.setBaseAndExtent(target.firstChild!, 0, target.firstChild!, 7);

    expect(selectionMayExist(document)).toBe(true);
    selection.collapseToStart();
    expect(selectionMayExist(document)).toBe(false);
  });
});
