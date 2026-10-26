const states = new WeakMap<Document, { knownEmpty: boolean }>();

/** Skip native selection reads only after this document was checked empty. */
export function selectionMayExist(document: Document): boolean {
  let state = states.get(document);
  if (!state) {
    state = { knownEmpty: false };
    states.set(document, state);
    const invalidate = () => markSelectionChanged(document);
    document.addEventListener("selectionchange", invalidate);
    for (const type of ["pointerdown", "mousedown", "touchstart", "keydown"])
      document.addEventListener(type, invalidate, true);
  }
  if (state.knownEmpty) return false;
  const selection = document.getSelection();
  state.knownEmpty =
    !selection || selection.rangeCount === 0 || selection.isCollapsed;
  return !state.knownEmpty;
}

/** Invalidate before changing a native selection, without waiting for its event. */
export function markSelectionChanged(document: Document): void {
  const state = states.get(document);
  if (state) state.knownEmpty = false;
}
