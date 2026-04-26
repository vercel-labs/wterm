import type { SvelteHTMLElements } from "svelte/elements";
import { WTerm } from "@wterm/dom";
type DivAttributes = SvelteHTMLElements["div"];
export interface TerminalProps extends Omit<DivAttributes, "onresize"> {
    /** Column count. */
    cols?: number;
    /** Row count. */
    rows?: number;
    /** Optional override for the WASM binary URL used by the terminal core. */
    wasmUrl?: string;
    /** Theme name appended as a `theme-<name>` class on the root element. */
    theme?: string;
    /**
     * When `true`, the terminal observes its container and reflows on size
     * changes. Defaults to `false` for framework wrappers.
     */
    autoResize?: boolean;
    /** Toggles the `cursor-blink` class on the root element. */
    cursorBlink?: boolean;
    /** Enable debug mode (init-only — changing after mount has no effect). */
    debug?: boolean;
    /** Called when the terminal produces input data. */
    onData?: (data: string) => void;
    /** Called when the terminal title changes via an escape sequence. */
    onTitle?: (title: string) => void;
    /** Called after the terminal is resized. */
    onResize?: (cols: number, rows: number) => void;
    /** Called once after `WTerm.init()` resolves. */
    onReady?: (wt: WTerm) => void;
    /** Called if WASM loading or initialization fails. */
    onError?: (error: unknown) => void;
}
declare const Terminal: import("svelte").Component<TerminalProps, {
    write: (data: string | Uint8Array) => void;
    resize: (nextCols: number, nextRows: number) => void;
    focus: () => void;
    instance: () => WTerm | null;
}, "">;
type Terminal = ReturnType<typeof Terminal>;
export default Terminal;
//# sourceMappingURL=Terminal.svelte.d.ts.map