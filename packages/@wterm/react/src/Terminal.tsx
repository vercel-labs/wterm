import {
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type HTMLAttributes,
} from "react";
import { WTerm } from "@wterm/dom";

export interface TerminalProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onResize"
> {
  cols?: number;
  rows?: number;
  wasmUrl?: string;
  theme?: string;
  autoResize?: boolean;
  cursorBlink?: boolean;
  onData?: (data: string) => void;
  onTitle?: (title: string) => void;
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
    wasmUrl,
    theme,
    autoResize = false,
    cursorBlink = false,
    onData,
    onTitle,
    onResize,
    onReady,
    onError,
    className,
    style,
    ...rest
  },
  ref,
) {
  const wtermRef = useRef<WTerm | null>(null);
  const callbacksRef = useRef({ onData, onTitle, onResize, onReady, onError });
  const autoResizeRef = useRef(autoResize);

  callbacksRef.current = { onData, onTitle, onResize, onReady, onError };
  autoResizeRef.current = autoResize;

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
        wasmUrl,
        autoResize: autoResizeRef.current,
        cursorBlink,
        onData: callbacksRef.current.onData
          ? (data: string) => callbacksRef.current.onData?.(data)
          : undefined,
        onTitle: (title: string) => callbacksRef.current.onTitle?.(title),
        onResize: (c: number, r: number) =>
          callbacksRef.current.onResize?.(c, r),
      });

      wtermRef.current = wt;

      wt.init()
        .then(() => {
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
    // Re-run only when the WASM source changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wasmUrl],
  );

  // Sync props to the existing instance (render-time checks)
  const wt = wtermRef.current;
  if (wt?.bridge) {
    if (!autoResizeRef.current && (wt.cols !== cols || wt.rows !== rows)) {
      wt.resize(cols, rows);
    }
    const el = wt.element;
    if (cursorBlink && !el.classList.contains("cursor-blink")) {
      el.classList.add("cursor-blink");
    } else if (!cursorBlink && el.classList.contains("cursor-blink")) {
      el.classList.remove("cursor-blink");
    }
    if (onData && !wt.onData) {
      wt.onData = (data: string) => callbacksRef.current.onData?.(data);
    } else if (!onData && wt.onData) {
      wt.onData = null;
    }
  }

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
      role="textbox"
      aria-label="Terminal"
      aria-multiline="true"
      aria-roledescription="terminal"
      {...rest}
    />
  );
});

export default Terminal;
