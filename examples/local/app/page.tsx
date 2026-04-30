"use client";

import { useCallback, useRef, useState } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import type { WTerm } from "@wterm/dom";
import type { TerminalCore } from "@wterm/core";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/react/css";

type CoreKind = "builtin" | "ghostty";

async function loadCore(kind: CoreKind): Promise<TerminalCore | undefined> {
  if (kind === "ghostty")
    return GhosttyCore.load({ wasmPath: "/ghostty-vt.wasm" });
  return undefined;
}

export default function LocalTerminal() {
  const [debugEnabled] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("debug"),
  );
  const [activeCore, setActiveCore] = useState<CoreKind>("builtin");
  const [core, setCore] = useState<TerminalCore | undefined>(undefined);
  const [switching, setSwitching] = useState(false);
  const { ref, write } = useTerminal();
  const wsRef = useRef<WebSocket | null>(null);

  const switchCore = useCallback(async (kind: CoreKind) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setSwitching(true);
    const loaded = await loadCore(kind);
    setCore(loaded);
    setActiveCore(kind);
    setSwitching(false);
  }, []);

  const handleReady = useCallback(
    (wt: WTerm) => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/api/terminal`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(`\x1b[RESIZE:${wt.cols};${wt.rows}]`);
      };

      ws.onmessage = (event: MessageEvent) => {
        write(event.data as string);
      };

      ws.onclose = () => {
        write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
        wsRef.current = null;
      };
    },
    [write],
  );

  const handleData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(`\x1b[RESIZE:${cols};${rows}]`);
    }
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b border-white/10 bg-white/3 px-4 py-2">
        <span className="text-xs tracking-wide text-white/40">Core</span>
        <div className="flex overflow-hidden rounded-md border border-white/10">
          <button
            onClick={() => switchCore("builtin")}
            disabled={switching}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              activeCore === "builtin"
                ? "bg-white/10 text-white"
                : "text-white/40 hover:bg-white/5"
            } disabled:opacity-50`}
          >
            Built-in
          </button>
          <button
            onClick={() => switchCore("ghostty")}
            disabled={switching}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              activeCore === "ghostty"
                ? "bg-white/10 text-white"
                : "text-white/40 hover:bg-white/5"
            } disabled:opacity-50`}
          >
            Ghostty
          </button>
        </div>
      </div>
      {!switching && (
        <Terminal
          key={activeCore}
          ref={ref}
          cols={80}
          rows={24}
          autoResize
          debug={debugEnabled}
          core={core}
          wasmUrl="/wterm.wasm"
          onReady={handleReady}
          onData={handleData}
          onResize={handleResize}
          className="flex-1"
          style={{ borderRadius: 0, boxShadow: "none", padding: 0 }}
        />
      )}
    </div>
  );
}
