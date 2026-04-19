import { WTerm, type WTermOptions } from "@wterm/dom";
import type { Action } from "svelte/action";
import {
  bindTerminalInstance,
  type TerminalController,
} from "./controller.js";

export interface WTermActionOptions extends WTermOptions {
  theme?: string;
  controller?: TerminalController;
  onReady?: (wt: WTerm) => void;
  onError?: (error: unknown) => void;
}

type ResolvedActionOptions = Omit<
  WTermActionOptions,
  "cols" | "rows" | "autoResize" | "cursorBlink"
> & {
  cols: number;
  rows: number;
  autoResize: boolean;
  cursorBlink: boolean;
};

function resolveOptions(options: WTermActionOptions = {}): ResolvedActionOptions {
  return {
    ...options,
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
    autoResize: options.autoResize ?? false,
    cursorBlink: options.cursorBlink ?? false,
  };
}

function getThemeClass(theme: string | undefined): string | null {
  return theme ? `theme-${theme}` : null;
}

function syncLiveOptions(wterm: WTerm, options: ResolvedActionOptions): void {
  if (!wterm.bridge) {
    return;
  }

  if (!options.autoResize && (wterm.cols !== options.cols || wterm.rows !== options.rows)) {
    wterm.resize(options.cols, options.rows);
  }

  wterm.element.classList.toggle("cursor-blink", options.cursorBlink);
  wterm.onData = options.onData ? (data: string) => options.onData?.(data) : null;
  wterm.onTitle = options.onTitle
    ? (title: string) => options.onTitle?.(title)
    : null;
  wterm.onResize = options.onResize
    ? (cols: number, rows: number) => options.onResize?.(cols, rows)
    : null;
}

export const wterm: Action<HTMLElement, WTermActionOptions> = (
  node,
  initialOptions = {},
) => {
  let options = resolveOptions(initialOptions);
  let terminal: WTerm | null = null;
  let disposed = false;
  let requestId = 0;
  let managedHeight = false;
  let themeClass = getThemeClass(options.theme);

  const syncPresentation = (nextOptions: ResolvedActionOptions) => {
    const nextThemeClass = getThemeClass(nextOptions.theme);
    if (themeClass && themeClass !== nextThemeClass) {
      node.classList.remove(themeClass);
    }
    if (nextThemeClass) {
      node.classList.add(nextThemeClass);
    }
    themeClass = nextThemeClass;

    node.classList.add("wterm");
    node.classList.toggle("cursor-blink", nextOptions.cursorBlink);
    node.setAttribute("role", "textbox");
    node.setAttribute("aria-label", "Terminal");
    node.setAttribute("aria-multiline", "true");
    node.setAttribute("aria-roledescription", "terminal");

    if (nextOptions.autoResize) {
      if (managedHeight) {
        node.style.height = "";
        managedHeight = false;
      }
      return;
    }

    if (managedHeight || !node.style.height) {
      node.style.height = `${nextOptions.rows * 17 + 24}px`;
      managedHeight = true;
    }
  };

  const clearPresentation = () => {
    if (themeClass) {
      node.classList.remove(themeClass);
      themeClass = null;
    }
    node.classList.remove("wterm", "cursor-blink", "has-scrollback");
    node.removeAttribute("role");
    node.removeAttribute("aria-label");
    node.removeAttribute("aria-multiline");
    node.removeAttribute("aria-roledescription");
    if (managedHeight) {
      node.style.height = "";
      managedHeight = false;
    }
  };

  const destroyTerminal = () => {
    requestId += 1;
    const current = terminal;
    terminal = null;
    current?.destroy();
    bindTerminalInstance(options.controller, null);
  };

  const startTerminal = async () => {
    const currentRequestId = ++requestId;
    const currentOptions = options;
    const currentTerminal = new WTerm(node, {
      cols: currentOptions.cols,
      rows: currentOptions.rows,
      wasmUrl: currentOptions.wasmUrl,
      autoResize: currentOptions.autoResize,
      cursorBlink: currentOptions.cursorBlink,
      onData: currentOptions.onData,
      onTitle: currentOptions.onTitle,
      onResize: currentOptions.onResize,
    });

    terminal = currentTerminal;
    bindTerminalInstance(currentOptions.controller, currentTerminal);

    try {
      await currentTerminal.init();
      if (disposed || currentRequestId !== requestId) {
        currentTerminal.destroy();
        bindTerminalInstance(currentOptions.controller, null);
        return;
      }

      syncLiveOptions(currentTerminal, currentOptions);
      currentOptions.onReady?.(currentTerminal);
    } catch (error) {
      if (disposed || currentRequestId !== requestId) {
        return;
      }

      currentTerminal.destroy();
      if (terminal === currentTerminal) {
        terminal = null;
      }
      bindTerminalInstance(currentOptions.controller, null);
      if (currentOptions.onError) {
        currentOptions.onError(error);
      } else {
        console.error(error);
      }
    }
  };

  syncPresentation(options);
  void startTerminal();

  return {
    update(nextOptions = {}) {
      const previousOptions = options;
      options = resolveOptions(nextOptions);
      syncPresentation(options);

      if (previousOptions.controller !== options.controller) {
        bindTerminalInstance(previousOptions.controller, null);
        bindTerminalInstance(options.controller, terminal);
      }

      if (!terminal) {
        void startTerminal();
        return;
      }

      if (
        previousOptions.wasmUrl !== options.wasmUrl ||
        previousOptions.autoResize !== options.autoResize
      ) {
        destroyTerminal();
        void startTerminal();
        return;
      }

      syncLiveOptions(terminal, options);
    },
    destroy() {
      disposed = true;
      destroyTerminal();
      clearPresentation();
    },
  };
};
