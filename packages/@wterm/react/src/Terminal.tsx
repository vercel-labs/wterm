import {
  useRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  forwardRef,
  type HTMLAttributes,
} from "react";
import { WTerm, type TerminalCore } from "@wterm/dom";

// onResize and onError are omitted from HTMLAttributes because we redefine
// them with different signatures (terminal dimensions / WASM init errors).
export interface TerminalProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onResize" | "onError"
> {
  cols?: number;
  rows?: number;
  /**
   * A pre-constructed terminal core. When provided, `wasmUrl` is ignored and
   * this core is used instead of loading the built-in Zig WASM binary.
   */
  core?: TerminalCore;
  wasmUrl?: string;
  theme?: string;
  autoResize?: boolean;
  /** Maximum rendered Kitty image width in CSS pixels. */
  maxImageWidth?: number;
  /** Maximum rendered Kitty image height in CSS pixels. */
  maxImageHeight?: number;
  /** Force blinking on/off; omit to follow the terminal application's request. */
  cursorBlink?: boolean;
  /** Politely announce terminal text changes while input has focus. */
  announceOutput?: boolean;
  /** Enable debug mode (init-only — changing after mount has no effect). */
  debug?: boolean;
  onData?: (data: string) => void;
  onBinary?: (data: Uint8Array) => void;
  onTitle?: (title: string) => void;
  onBell?: (count: number) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: (wt: WTerm) => void;
  onError?: (error: unknown) => void;
}

export interface TerminalHandle {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  readonly instance: WTerm | null;
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  {
    cols = 80,
    rows = 24,
    core,
    wasmUrl,
    theme,
    autoResize = false,
    maxImageWidth,
    maxImageHeight,
    cursorBlink,
    announceOutput = false,
    debug = false,
    onData,
    onBinary,
    onTitle,
    onBell,
    onResize,
    onReady,
    onError,
    className,
    style,
    ...htmlProps
  }: TerminalProps,
  ref: React.ForwardedRef<TerminalHandle>,
) {
  const wtermRef = useRef<WTerm | null>(null);
  const callbacksRef = useRef({
    onData,
    onBinary,
    onTitle,
    onBell,
    onResize,
    onReady,
    onError,
  });
  const autoResizeRef = useRef(autoResize);
  const requestedSizeRef = useRef({ cols, rows });
  const latestSizeRef = useRef({ cols, rows });
  const previousAutoResizeRef = useRef(autoResize);

  callbacksRef.current = {
    onData,
    onBinary,
    onTitle,
    onBell,
    onResize,
    onReady,
    onError,
  };
  autoResizeRef.current = autoResize;
  latestSizeRef.current = { cols, rows };

  useImperativeHandle(ref, () => ({
    write(data: string | Uint8Array) {
      wtermRef.current?.write(data);
    },
    resize(c: number, r: number) {
      wtermRef.current?.resize(c, r);
    },
    focus() {
      wtermRef.current?.focus();
    },
    get instance() {
      return wtermRef.current;
    },
  }));

  // React 19 callback ref with cleanup — replaces useEffect for
  // imperative, non-React library init that requires a DOM element.
  const containerRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;

      const wt = new WTerm(el, {
        cols,
        rows,
        core,
        wasmUrl,
        autoResize: autoResizeRef.current,
        maxImageWidth,
        maxImageHeight,
        cursorBlink,
        announceOutput,
        debug,
        onData: callbacksRef.current.onData
          ? (data: string) => callbacksRef.current.onData?.(data)
          : undefined,
        onBinary: callbacksRef.current.onBinary
          ? (data: Uint8Array) => callbacksRef.current.onBinary?.(data)
          : undefined,
        onTitle: (title: string) => callbacksRef.current.onTitle?.(title),
        onBell: (count: number) => callbacksRef.current.onBell?.(count),
        onResize: (c: number, r: number) =>
          callbacksRef.current.onResize?.(c, r),
      });

      wtermRef.current = wt;
      requestedSizeRef.current = { cols, rows };

      wt.init()
        .then(() => {
          if (wtermRef.current !== wt) return;
          const requested = latestSizeRef.current;
          if (
            !autoResizeRef.current &&
            (requestedSizeRef.current.cols !== requested.cols ||
              requestedSizeRef.current.rows !== requested.rows)
          ) {
            wt.resize(requested.cols, requested.rows);
            requestedSizeRef.current = requested;
          }
          callbacksRef.current.onReady?.(wt);
        })
        .catch((err: unknown) => {
          if (callbacksRef.current.onError) {
            callbacksRef.current.onError(err);
          } else {
            console.error(err);
          }
        });

      return () => {
        wt.destroy();
        wtermRef.current = null;
      };
    },
    // Re-run when the WASM source or image sizing options change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [core, wasmUrl, maxImageWidth, maxImageHeight],
  );

  // Sync props to the existing instance (render-time checks)
  const wt = wtermRef.current;
  if (wt?.bridge) {
    if (
      !autoResizeRef.current &&
      (previousAutoResizeRef.current ||
        requestedSizeRef.current.cols !== cols ||
        requestedSizeRef.current.rows !== rows)
    ) {
      wt.resize(cols, rows);
      requestedSizeRef.current = { cols, rows };
    }
    if (onData && !wt.onData) {
      wt.onData = (data: string) => callbacksRef.current.onData?.(data);
    } else if (!onData && wt.onData) {
      wt.onData = null;
    }
    if (onBinary && !wt.onBinary) {
      wt.onBinary = (data: Uint8Array) => callbacksRef.current.onBinary?.(data);
    } else if (!onBinary && wt.onBinary) {
      wt.onBinary = null;
    }
  }
  previousAutoResizeRef.current = autoResize;

  // Update individual classes after React commits so blink changes preserve
  // the focus and scrollback classes managed by WTerm.
  useLayoutEffect(() => {
    const el = wtermRef.current?.element;
    wtermRef.current?.setOutputAnnouncements(announceOutput);
    el?.classList.toggle("cursor-blink", cursorBlink === true);
    el?.classList.toggle("cursor-steady", cursorBlink === false);
  });

  const themeClass = theme ? `theme-${theme}` : "";
  const classes = ["wterm", themeClass, className].filter(Boolean).join(" ");

  const mergedStyle: React.CSSProperties = {
    ...(autoResize ? undefined : { height: rows * 17 + 24 }),
    ...style,
  };

  return (
    <div
      ref={containerRef}
      className={classes || undefined}
      style={mergedStyle}
      role="group"
      aria-label="Terminal"
      aria-roledescription="terminal"
      {...htmlProps}
    />
  );
});

export default Terminal;
