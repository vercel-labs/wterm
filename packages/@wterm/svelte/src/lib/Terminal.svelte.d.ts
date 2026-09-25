import type { SvelteComponentTyped } from "svelte";
import type { WTerm, WTermOptions } from "@wterm/dom";

export interface TerminalProps extends Omit<
  WTermOptions,
  "onData" | "onBinary" | "onTitle" | "onBell" | "onResize"
> {
  theme?: string;
  className?: string;
  onData?: (data: string) => void;
  onBinary?: (data: Uint8Array) => void;
  onTitle?: (title: string) => void;
  onBell?: (count: number) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: (wt: WTerm) => void;
  onError?: (error: unknown) => void;
  ondata?: (data: string) => void;
  onbinary?: (data: Uint8Array) => void;
  ontitle?: (title: string) => void;
  onbell?: (count: number) => void;
  onresize?: (cols: number, rows: number) => void;
  onready?: (wt: WTerm) => void;
  onerror?: (error: unknown) => void;
  class?: string;
  style?: string;
  id?: string;
  /** Bind this prop to access the underlying WTerm instance. */
  instance?: WTerm | null;
  [key: string]: unknown;
}

export interface TerminalHandle {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
}

export default class Terminal extends SvelteComponentTyped<TerminalProps> {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
}
