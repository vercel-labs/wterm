import type { WTerm } from "@wterm/dom";

export interface TerminalController {
  readonly instance: WTerm | null;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
}

type MutableTerminalController = TerminalController & {
  setInstance(instance: WTerm | null): void;
};

export function createTerminalController(): TerminalController {
  let instance: WTerm | null = null;

  const controller: MutableTerminalController = {
    get instance() {
      return instance;
    },
    setInstance(nextInstance: WTerm | null) {
      instance = nextInstance;
    },
    write(data: string | Uint8Array) {
      instance?.write(data);
    },
    resize(cols: number, rows: number) {
      instance?.resize(cols, rows);
    },
    focus() {
      instance?.focus();
    },
  };

  return controller;
}

export function bindTerminalInstance(
  controller: TerminalController | undefined,
  instance: WTerm | null,
): void {
  (controller as MutableTerminalController | undefined)?.setInstance(instance);
}
