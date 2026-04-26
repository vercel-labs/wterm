<script lang="ts">
  import { onMount } from "svelte";
  import type { SvelteHTMLElements } from "svelte/elements";
  import { WTerm } from "@wterm/dom";

  type DivAttributes = SvelteHTMLElements["div"];

  export interface TerminalProps
    extends Omit<DivAttributes, "onresize"> {
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

  let {
    cols = 80,
    rows = 24,
    wasmUrl,
    theme,
    autoResize = false,
    cursorBlink = false,
    debug = false,
    onData,
    onTitle,
    onResize,
    onReady,
    onError,
    class: className = "",
    style,
    ...rest
  }: TerminalProps = $props();

  let root: HTMLDivElement;
  let current: WTerm | null = $state(null);

  export function write(data: string | Uint8Array) {
    current?.write(data);
  }

  export function resize(nextCols: number, nextRows: number) {
    current?.resize(nextCols, nextRows);
  }

  export function focus() {
    current?.focus();
  }

  export function instance() {
    return current;
  }

  const classes = $derived(
    ["wterm", theme ? `theme-${theme}` : null, className]
      .filter(Boolean)
      .join(" "),
  );

  const mergedStyle = $derived.by(() => {
    if (autoResize) return style;
    const fixedHeight = `height: ${rows * 17 + 24}px`;
    return style ? `${fixedHeight}; ${style}` : fixedHeight;
  });

  onMount(() => {
    const wt = new WTerm(root, {
      cols,
      rows,
      wasmUrl,
      autoResize,
      cursorBlink,
      debug,
      onData: onData ? (data: string) => onData?.(data) : undefined,
      onTitle: (title: string) => onTitle?.(title),
      onResize: (nextCols: number, nextRows: number) =>
        onResize?.(nextCols, nextRows),
    });

    current = wt;

    wt.init()
      .then(() => {
        onReady?.(wt);
      })
      .catch((err: unknown) => {
        if (onError) {
          onError(err);
        } else {
          console.error(err);
        }
      });

    return () => {
      wt.destroy();
      if (current === wt) current = null;
    };
  });

  $effect(() => {
    const wt = current;
    if (
      wt?.bridge &&
      !autoResize &&
      (wt.cols !== cols || wt.rows !== rows)
    ) {
      wt.resize(cols, rows);
    }
  });

  $effect(() => {
    current?.element.classList.toggle("cursor-blink", cursorBlink);
  });
</script>

<div
  {...rest}
  bind:this={root}
  class={classes || undefined}
  style={mergedStyle}
  role="textbox"
  aria-label="Terminal"
  aria-multiline="true"
  aria-roledescription="terminal"
></div>
