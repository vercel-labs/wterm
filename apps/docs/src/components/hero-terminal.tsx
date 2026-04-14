"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal, useTerminal } from "@wterm/react";
import { BashShell } from "@wterm/just-bash";
import "@wterm/react/css";

const INITIAL_FILES: Record<string, string> = {
  "/home/user/README.md":
    "# wterm\n\nA terminal emulator built with Zig and WebAssembly.\nRuns entirely in the browser — no backend required.\n",
  "/home/user/package.json":
    '{\n  "name": "wterm",\n  "version": "0.1.0",\n  "description": "Zig/WASM terminal emulator"\n}\n',
};

const THEMES = [
  { value: "", label: "Default" },
  { value: "solarized-dark", label: "Solarized" },
  { value: "monokai", label: "Monokai" },
  { value: "light", label: "Light" },
] as const;

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
  theme,
  fullscreen,
}: {
  theme?: string;
  fullscreen?: boolean;
}) {
  const { ref, write } = useTerminal();
  const shellRef = useRef<BashShell | null>(null);

  const handleReady = useCallback(() => {
    const shell = new BashShell({
      files: INITIAL_FILES,
      greeting: [
        "\x1b[1;36mwterm\x1b[0m — Zig/WASM terminal emulator",
        "",
        "Try: \x1b[33mls\x1b[0m, \x1b[33mcat README.md\x1b[0m, \x1b[33mecho hello\x1b[0m",
        "",
      ],
      network: { dangerouslyAllowFullInternetAccess: true },
    });
    shellRef.current = shell;
    shell.attach(write);
  }, [write]);

  const handleData = useCallback((data: string) => {
    shellRef.current?.handleInput(data);
  }, []);

  return (
    <Terminal
      ref={ref}
      cols={80}
      rows={fullscreen ? 24 : 16}
      autoResize={fullscreen}
      wasmUrl="/wterm.wasm"
      theme={theme}
      onReady={handleReady}
      onData={handleData}
      className={fullscreen ? "h-full w-full text-sm" : "w-full text-sm"}
    />
  );
}

export function HeroSection() {
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
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              theme === value
                ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={() => setFullscreen((f) => !f)}
            className="rounded-md px-2 py-1 text-neutral-500 hover:text-neutral-700 transition-colors dark:text-neutral-500 dark:hover:text-neutral-300"
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
