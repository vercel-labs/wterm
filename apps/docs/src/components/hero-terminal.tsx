"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal, preload } from "react-dom";
import { Terminal, useTerminal } from "@wterm/react";
import type { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import { BashShell } from "@wterm/just-bash";
import "@wterm/react/css";

const INITIAL_FILES: Record<string, string> = {
  "/home/user/README.md":
    "# wterm\n\nA terminal emulator for the web.\nRenders to the DOM — native text selection, copy/paste, and accessibility come for free.\nThis example uses Ghostty's VT engine in WebAssembly.\n",
  "/home/user/package.json":
    '{\n  "name": "wterm",\n  "version": "0.1.0",\n  "description": "Terminal emulator for the web"\n}\n',
};

const THEMES = [
  { value: "", label: "Default" },
  { value: "solarized-dark", label: "Solarized" },
  { value: "monokai", label: "Monokai" },
  { value: "light", label: "Light" },
] as const;

function syncGhosttyColors(term: WTerm) {
  const styles = getComputedStyle(term.element);
  const palette = Array.from(
    { length: 16 },
    (_, index) =>
      `${index};${styles.getPropertyValue(`--term-color-${index}`).trim()}`,
  ).join(";");
  const foreground = styles.getPropertyValue("--term-fg").trim();
  const background = styles.getPropertyValue("--term-bg").trim();
  term.write(
    `\x1b]4;${palette}\x1b\\\x1b]10;${foreground}\x1b\\\x1b]11;${background}\x1b\\`,
  );
}

function FullscreenIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="5.5 1 1 1 1 5.5" />
      <polyline points="10.5 1 15 1 15 5.5" />
      <polyline points="10.5 15 15 15 15 10.5" />
      <polyline points="5.5 15 1 15 1 10.5" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1 5.5 5.5 5.5 5.5 1" />
      <polyline points="15 5.5 10.5 5.5 10.5 1" />
      <polyline points="15 10.5 10.5 10.5 10.5 15" />
      <polyline points="1 10.5 5.5 10.5 5.5 15" />
    </svg>
  );
}

const GREETING = [
  { text: "wterm — terminal emulator for the web" },
  { text: "" },
  { text: "Try: ls, cat README.md, echo hello", dim: true },
  { text: "" },
];
const PROMPT_USER = "user@wterm";

function Preview() {
  return (
    <div className="term-grid">
      {GREETING.map(({ text, dim }, index) => (
        <div className="term-row" key={index}>
          <span
            style={{
              opacity: dim ? 0.5 : undefined,
            }}
          >
            {text}
          </span>
        </div>
      ))}
      <div className="term-row">
        <span
          style={{
            color: "var(--term-color-2)",
            fontWeight: "bold",
          }}
        >
          {PROMPT_USER}
        </span>
        <span>:</span>
        <span style={{ color: "var(--term-color-4)", fontWeight: "bold" }}>
          ~
        </span>
        <span>{"$ "}</span>
        <span className="term-cursor"> </span>
      </div>
    </div>
  );
}

function HeroTerminal({
  theme,
  fullscreen,
}: {
  theme?: string;
  fullscreen?: boolean;
}) {
  const { ref } = useTerminal();
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [loadError, setLoadError] = useState(false);
  const onError = useCallback(() => setLoadError(true), []);
  useEffect(() => {
    let active = true;
    let loadedCore: GhosttyCore | null = null;

    void GhosttyCore.load({ wasmPath: "/ghostty-vt.wasm" }).then(
      (loaded) => {
        if (!active) {
          loaded.dispose();
          return;
        }
        loadedCore = loaded;
        setCore(loaded);
      },
      () => {
        if (active) setLoadError(true);
      },
    );

    return () => {
      active = false;
      loadedCore?.dispose();
    };
  }, []);

  const shellRef = useRef<BashShell | null>(null);
  const frameRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      shellRef.current = null;
    };
  }, []);

  const handleReady = useCallback(
    (term: WTerm) => {
      syncGhosttyColors(term);
      const shell = new BashShell({
        files: INITIAL_FILES,
        greeting: GREETING.map(({ text, dim }) =>
          dim ? `\x1b[2m${text}\x1b[0m` : text,
        ),
        prompt: (cwd) =>
          `\x1b[1;32m${PROMPT_USER}\x1b[0m:\x1b[1;34m${cwd.replace(/^\/home\/user/, "~")}\x1b[0m$ `,
        network: { dangerouslyAllowFullInternetAccess: true },
      });
      void shell
        .attach((data) => {
          if (ref.current?.instance === term) term.write(data);
        })
        .then(
          () => {
            if (ref.current?.instance !== term) return;
            shellRef.current = shell;
            // Writes schedule a renderer frame. Keep the preview above that frame
            // through a completed paint before exposing the live surface and input.
            frameRef.current = requestAnimationFrame(() => {
              frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                if (ref.current?.instance === term) setReady(true);
              });
            });
          },
          () => {
            if (ref.current?.instance === term) onError();
          },
        );
    },
    [ref, onError],
  );

  const handleData = useCallback((data: string) => {
    void shellRef.current?.handleInput(data);
  }, []);

  useEffect(() => {
    // The root class is also used for the first server-rendered frame. Read
    // the resulting CSS colors so presets and the site's resolved theme agree.
    const sync = () => {
      const term = ref.current?.instance;
      if (term?.bridge) syncGhosttyColors(term);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [theme, ref]);

  useEffect(() => {
    if (ready && fullscreen) ref.current?.focus();
  }, [ready, fullscreen, ref]);

  return (
    <div
      className={`hero-terminal ${fullscreen ? "hero-terminal-fullscreen" : ""}`}
      data-state={loadError ? "failed" : ready ? "ready" : "starting"}
      aria-busy={!ready && !loadError}
    >
      {!ready || loadError ? (
        <div
          className={`wterm hero-terminal-preview ${theme ? `theme-${theme}` : ""}`}
          role={loadError ? "status" : "img"}
          aria-label={loadError ? undefined : "Terminal greeting"}
        >
          {loadError ? (
            "The terminal could not load. Refresh to try again."
          ) : (
            <Preview />
          )}
        </div>
      ) : null}
      {!ready && !loadError ? (
        <span className="sr-only" role="status">
          Starting interactive terminal
        </span>
      ) : null}
      {core && !loadError ? (
        <div className="hero-terminal-live" inert={!ready} aria-hidden={!ready}>
          <Terminal
            ref={ref}
            core={core}
            cols={80}
            rows={fullscreen ? 24 : 16}
            autoResize={fullscreen}
            theme={theme}
            onReady={handleReady}
            onData={handleData}
            onError={onError}
            className="h-full w-full"
          />
        </div>
      ) : null}
    </div>
  );
}

export function HeroSection() {
  preload("/ghostty-vt.wasm", {
    as: "fetch",
    type: "application/wasm",
    crossOrigin: "anonymous",
  });
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // Controls become actionable only after their event handlers are mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);
  const [theme, setTheme] = useState("");
  const [fullscreen, setFullscreen] = useState(false);

  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );

  // Syncs a fullscreen portal container with the DOM — setState is
  // intentional here because the render needs the container element.
  useEffect(() => {
    if (!fullscreen) return;

    const container = document.createElement("div");
    container.id = "wterm-fullscreen";
    document.body.appendChild(container);

    // Hide every other direct child of <body> so nothing shows
    // through Safari's translucent toolbar glass
    const hidden: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === container) continue;
      const el = child as HTMLElement;
      if (el.style !== undefined) {
        el.dataset.prevDisplay = el.style.display;
        el.style.display = "none";
        hidden.push(el);
      }
    }

    const previousOverflow = document.body.style.overflow;
    const previousBodyBackground = document.body.style.background;
    const previousRootBackground = document.documentElement.style.background;
    document.body.style.overflow = "hidden";
    document.body.style.background = "var(--ds-background-100)";
    document.documentElement.style.background = "var(--ds-background-100)";

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalContainer(container);

    return () => {
      for (const el of hidden) {
        el.style.display = el.dataset.prevDisplay ?? "";
        delete el.dataset.prevDisplay;
      }
      document.body.style.overflow = previousOverflow;
      document.body.style.background = previousBodyBackground;
      document.documentElement.style.background = previousRootBackground;
      container.remove();
      setPortalContainer(null);
    };
  }, [fullscreen]);

  return (
    <>
      <div className="mb-3 flex items-center gap-1.5">
        {THEMES.map(({ value, label }) => (
          <button
            key={value}
            disabled={!hydrated}
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              theme === value
                ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto">
          <button
            disabled={!hydrated}
            onClick={() => setFullscreen((f) => !f)}
            className="rounded-md px-2 py-1 text-neutral-500 hover:text-neutral-700 transition-colors dark:text-neutral-400 dark:hover:text-neutral-300"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <CollapseIcon /> : <FullscreenIcon />}
          </button>
        </div>
      </div>
      {fullscreen && portalContainer
        ? createPortal(
            <div
              style={{
                position: "fixed",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                background: "var(--ds-background-100)",
                padding:
                  "max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))",
              }}
            >
              <div className="mb-3 flex items-center gap-1.5">
                {THEMES.map(({ value, label }) => (
                  <button
                    key={value}
                    disabled={!hydrated}
                    onClick={() => setTheme(value)}
                    aria-pressed={theme === value}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                      theme === value
                        ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                        : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <div className="ml-auto">
                  <button
                    disabled={!hydrated}
                    onClick={() => setFullscreen(false)}
                    className="rounded-md px-2 py-1 text-neutral-500 hover:text-neutral-700 transition-colors dark:text-neutral-400 dark:hover:text-neutral-300"
                    title="Exit fullscreen"
                  >
                    <CollapseIcon />
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <HeroTerminal theme={theme} fullscreen />
              </div>
            </div>,
            portalContainer,
          )
        : null}
      {!fullscreen && <HeroTerminal theme={theme} />}
    </>
  );
}
