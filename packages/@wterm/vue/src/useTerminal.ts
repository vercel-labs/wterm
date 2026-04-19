import { shallowRef } from "vue";
import type { ShallowRef } from "vue";
import type { TerminalHandle } from "./Terminal.js";

export function useTerminal(): {
  ref: ShallowRef<TerminalHandle | null>;
  attach(instance: TerminalHandle | null): void;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
} {
  const terminalRef = shallowRef<TerminalHandle | null>(null);

  const attach = (instance: TerminalHandle | null) => {
    terminalRef.value = instance;
  };

  const write = (data: string | Uint8Array) => {
    terminalRef.value?.write(data);
  };

  const resize = (cols: number, rows: number) => {
    terminalRef.value?.resize(cols, rows);
  };

  const focus = () => {
    terminalRef.value?.focus();
  };

  return {
    ref: terminalRef,
    attach,
    write,
    resize,
    focus,
  };
}
