import { expect, type Page } from "@playwright/test";

/** Hold terminal startup even when its compiled WASM module is cached. */
export async function delayWasmInstantiation(page: Page) {
  const gate = await page.evaluateHandle(() => {
    const instantiate = WebAssembly.instantiate;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = {
      started: false,
      release() {
        WebAssembly.instantiate = instantiate;
        release();
      },
    };
    WebAssembly.instantiate = (async (
      ...args: Parameters<typeof WebAssembly.instantiate>
    ) => {
      state.started = true;
      await pending;
      return instantiate(...args);
    }) as typeof WebAssembly.instantiate;
    return state;
  });
  return {
    waitUntilStarted: () =>
      expect.poll(() => gate.evaluate((state) => state.started)).toBe(true),
    release: () => gate.evaluate((state) => state.release()),
  };
}
