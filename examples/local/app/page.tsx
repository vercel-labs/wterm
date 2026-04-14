"use client";

import { useCallback, useRef } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";

export default function LocalTerminal() {
  const { ref, write } = useTerminal();
  const wsRef = useRef<WebSocket | null>(null);

  const handleReady = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/api/terminal`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event: MessageEvent) => {
      write(event.data as string);
    };

    ws.onclose = () => {
      write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
      wsRef.current = null;
    };
  }, [write]);

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
      <Terminal
        ref={ref}
        cols={80}
        rows={24}
        autoResize
        wasmUrl="/wterm.wasm"
        onReady={handleReady}
        onData={handleData}
        onResize={handleResize}
        className="flex-1"
      />
    </div>
  );
}
