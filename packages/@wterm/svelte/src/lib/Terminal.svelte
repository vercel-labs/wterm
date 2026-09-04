<script context="module" lang="ts">
  import type {
    WTerm as WTermType,
    WTermOptions,
  } from "@wterm/dom";

  export interface TerminalEvents {
    data: string;
    title: string;
    resize: [cols: number, rows: number];
    ready: WTermType;
    error: unknown;
  }

  export interface TerminalProps
    extends Omit<WTermOptions, "onData" | "onTitle" | "onResize"> {
    theme?: string;
    className?: string;
    onData?: (data: string) => void;
    onTitle?: (title: string) => void;
    onResize?: (cols: number, rows: number) => void;
    onReady?: (wt: WTermType) => void;
    onError?: (error: unknown) => void;
    ondata?: (data: string) => void;
    ontitle?: (title: string) => void;
    onresize?: (cols: number, rows: number) => void;
    onready?: (wt: WTermType) => void;
    onerror?: (error: unknown) => void;
    class?: string;
    style?: string;
    id?: string;
    instance?: WTermType | null;
    [key: string]: unknown;
  }

  export interface TerminalHandle {
    write(data: string | Uint8Array): void;
    resize(cols: number, rows: number): void;
    focus(): void;
  }
</script>

<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  // Svelte does not expose the legacy component event map through its public
  // API. The event dispatcher stores it on the current legacy effect context.
  // @ts-ignore -- svelte/internal/client intentionally has no public types.
  import { active_effect } from "svelte/internal/client";
  import { WTerm, type TerminalCore } from "@wterm/dom";

  const dispatch = createEventDispatcher<TerminalEvents>();

  export let cols = 80;
  export let rows = 24;
  export let core: TerminalCore | undefined = undefined;
  export let wasmUrl: string | undefined = undefined;
  export let theme: string | undefined = undefined;
  export let autoResize = false;
  export let maxImageWidth: number | undefined = undefined;
  export let maxImageHeight: number | undefined = undefined;
  export let cursorBlink = false;
  export let debug = false;
  export let className = "";
  export let onData: ((data: string) => void) | undefined = undefined;
  export let onTitle: ((title: string) => void) | undefined = undefined;
  export let onResize: ((cols: number, rows: number) => void) | undefined =
    undefined;
  export let onReady: ((wt: WTerm) => void) | undefined = undefined;
  export let onError: ((error: unknown) => void) | undefined = undefined;
  export let ondata: ((data: string) => void) | undefined = undefined;
  export let ontitle: ((title: string) => void) | undefined = undefined;
  export let onresize: ((cols: number, rows: number) => void) | undefined =
    undefined;
  export let onready: ((wt: WTerm) => void) | undefined = undefined;
  export let onerror: ((error: unknown) => void) | undefined = undefined;

  let element: HTMLDivElement;
  export let instance: WTerm | null = null;
  let legacyDataListener = false;
  let legacyProps: Record<string, unknown> | undefined;

  $: classes = [
    "wterm",
    theme ? `theme-${theme}` : "",
    cursorBlink ? "cursor-blink" : "",
    className,
    typeof $$restProps.class === "string" ? $$restProps.class : "",
  ]
    .filter(Boolean)
    .join(" ");

  $: heightStyle = autoResize ? "" : `height: ${rows * 17 + 24}px`;
  $: mergedStyle = [heightStyle, $$restProps.style]
    .filter(Boolean)
    .join("; ");

  function handleData(data: string): void {
    onData?.(data);
    ondata?.(data);
    dispatch("data", data);
  }

  function handleTitle(title: string): void {
    onTitle?.(title);
    ontitle?.(title);
    dispatch("title", title);
  }

  function handleResize(nextCols: number, nextRows: number): void {
    onResize?.(nextCols, nextRows);
    onresize?.(nextCols, nextRows);
    dispatch("resize", [nextCols, nextRows]);
  }

  function hasLegacyDataListener(): boolean {
    const props =
      legacyProps ??
      ((active_effect as any)?.ctx?.s as
        | Record<string, unknown>
        | undefined);
    legacyProps ??= props;
    const events = props?.["$$events"] as Record<string, unknown> | undefined;
    const dataHandlers = events?.data;
    return Array.isArray(dataHandlers)
      ? dataHandlers.length > 0
      : Boolean(dataHandlers);
  }

  function hasDataHandler(): boolean {
    return Boolean(onData || ondata || legacyDataListener);
  }

  export function write(data: string | Uint8Array): void {
    instance?.write(data);
  }

  export function resize(nextCols: number, nextRows: number): void {
    instance?.resize(nextCols, nextRows);
  }

  export function focus(): void {
    instance?.focus();
  }

  onMount(() => {
    let disposed = false;
    legacyDataListener = hasLegacyDataListener();
    const wt = new WTerm(element, {
      cols,
      rows,
      core,
      wasmUrl,
      autoResize,
      maxImageWidth,
      maxImageHeight,
      cursorBlink,
      debug,
      onData: hasDataHandler() ? handleData : undefined,
      onTitle: handleTitle,
      onResize: handleResize,
    });

    instance = wt;

    wt.init()
      .then(() => {
        if (disposed) return;
        onReady?.(wt);
        onready?.(wt);
        dispatch("ready", wt);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        onError?.(error);
        onerror?.(error);
        dispatch("error", error);
        if (!onError && !onerror) console.error(error);
      });

    return () => {
      disposed = true;
      wt.destroy();
      if (instance === wt) instance = null;
    };
  });

  // Keep the small set of mutable options that WTerm supports in sync with
  // the component. Core, WASM source, and image sizing are init-time options.
  $: if (instance?.bridge) {
    legacyDataListener = hasLegacyDataListener();
    if (!autoResize && (instance.cols !== cols || instance.rows !== rows)) {
      instance.resize(cols, rows);
    }
    instance.element.classList.toggle("cursor-blink", cursorBlink);
    instance.onData = hasDataHandler() ? handleData : null;
  }
</script>

<div
  bind:this={element}
  {...$$restProps}
  class={classes}
  style={mergedStyle || undefined}
  role={$$restProps.role ?? "textbox"}
  aria-label={$$restProps["aria-label"] ?? "Terminal"}
  aria-multiline={$$restProps["aria-multiline"] ?? "true"}
  aria-roledescription={$$restProps["aria-roledescription"] ?? "terminal"}
></div>
