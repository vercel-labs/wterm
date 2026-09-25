"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

function HeroTerminal({
  core,
  loadError,
  onError,
  theme,
  fullscreen,
}: {
  core: GhosttyCore | null;
  loadError: boolean;
  onError: () => void;
  theme?: string;
  fullscreen?: boolean;
}) {
  const { ref, write } = useTerminal();
  const shellRef = useRef<BashShell | null>(null);

  const handleReady = useCallback(
    (term: WTerm) => {
      syncGhosttyColors(term);
      const shell = new BashShell({
        files: INITIAL_FILES,
        greeting: [
          "wterm — terminal emulator for the web",
          "",
          "\x1b[2mTry: ls, cat README.md, echo hello\x1b[0m",
          "",
        ],
        network: { dangerouslyAllowFullInternetAccess: true },
      });
      shellRef.current = shell;
      shell.attach(write);
    },
    [write],
  );

  const handleData = useCallback((data: string) => {
    shellRef.current?.handleInput(data);
  }, []);

  useEffect(() => {
    const term = ref.current?.instance;
    if (term && shellRef.current) syncGhosttyColors(term);
  }, [theme, ref]);

  if (!core || loadError) {
    return (
      <div
        role="status"
        className={`wterm ${theme ? `theme-${theme}` : ""} ${fullscreen ? "h-full w-full text-sm" : "w-full text-sm"}`}
        style={fullscreen ? undefined : { minHeight: 296 }}
      >
        {loadError
          ? "The terminal could not load. Refresh to try again."
          : "Loading terminal…"}
      </div>
    );
  }

  return (
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
      className={fullscreen ? "h-full w-full text-sm" : "w-full text-sm"}
    />
  );
}

export function HeroSection() {
  const [theme, setTheme] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );

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

    document.body.style.overflow = "hidden";
    document.body.style.background = "#000";
    document.documentElement.style.background = "#000";

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalContainer(container);

    return () => {
      for (const el of hidden) {
        el.style.display = el.dataset.prevDisplay ?? "";
        delete el.dataset.prevDisplay;
      }
      document.body.style.overflow = "";
      document.body.style.background = "";
      document.documentElement.style.background = "";
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
                background: "#000",
                padding:
                  "max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))",
              }}
            >
              <div className="mb-3 flex items-center gap-1.5">
                {THEMES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    aria-pressed={theme === value}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                      theme === value
                        ? "bg-neutral-700 text-neutral-100"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <div className="ml-auto">
                  <button
                    onClick={() => setFullscreen(false)}
                    className="rounded-md px-2 py-1 text-neutral-400 hover:text-neutral-200 transition-colors"
                    title="Exit fullscreen"
                  >
                    <CollapseIcon />
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <HeroTerminal
                  core={core}
                  loadError={loadError}
                  onError={() => setLoadError(true)}
                  theme={theme}
                  fullscreen
                />
              </div>
            </div>,
            portalContainer,
          )
        : null}
      {!fullscreen && (
        <HeroTerminal
          core={core}
          loadError={loadError}
          onError={() => setLoadError(true)}
          theme={theme}
        />
      )}
    </>
  );
}
