import type { SvelteComponentTyped } from "svelte";
import type { WTerm, WTermOptions, ShellIntegrationState } from "@wterm/dom";

export interface TerminalProps extends Omit<
  WTermOptions,
  | "onData"
  | "onBinary"
  | "onTitle"
  | "onWorkingDirectory"
  | "onBell"
  | "onClipboardWrite"
  | "onShellIntegration"
  | "onResize"
> {
  theme?: string;
  className?: string;
  onData?: (data: string) => void;
  onBinary?: (data: Uint8Array) => void;
  onTitle?: (title: string) => void;
  onWorkingDirectory?: (uri: string) => void;
  onBell?: (count: number) => void;
  onClipboardWrite?: (text: string) => void;
  onShellIntegration?: (state: ShellIntegrationState) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: (wt: WTerm) => void;
  onError?: (error: unknown) => void;
  ondata?: (data: string) => void;
  onbinary?: (data: Uint8Array) => void;
  ontitle?: (title: string) => void;
  onworkingdirectory?: (uri: string) => void;
  onbell?: (count: number) => void;
  onclipboardwrite?: (text: string) => void;
  onshellintegration?: (state: ShellIntegrationState) => void;
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
