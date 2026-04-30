"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import type { WTerm } from "@wterm/dom";
import type { TerminalCore } from "@wterm/core";
import { GhosttyCore } from "@wterm/ghostty";
import { CoreToggle } from "../core-toggle";
import "@wterm/react/css";

export default function GhosttyTerminal() {
  const [debugEnabled] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("debug"),
  );
  const [core, setCore] = useState<TerminalCore | null>(null);
  const { ref, write } = useTerminal();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    GhosttyCore.load({ wasmPath: "/ghostty-vt.wasm" }).then(setCore);
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

  if (!core) return null;

  return (
    <div className="flex h-screen flex-col">
      <CoreToggle />
      <Terminal
        ref={ref}
        cols={80}
        rows={24}
        autoResize
        debug={debugEnabled}
        core={core}
        onReady={handleReady}
        onData={handleData}
        onResize={handleResize}
        className="flex-1"
        style={{ borderRadius: 0, boxShadow: "none", padding: 0 }}
      />
    </div>
  );
}
