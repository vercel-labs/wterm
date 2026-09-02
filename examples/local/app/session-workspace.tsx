"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Plus, X } from "lucide-react";
import { Terminal as WTermTerminal, useTerminal } from "@wterm/react";
import type { TerminalCore, WTerm } from "@wterm/dom";
import "@wterm/react/css";

type SessionStatus = "loading" | "connecting" | "connected" | "closed";

interface Session {
  id: string;
  name: string;
  status: SessionStatus;
  cwd: string | null;
}

interface WorkspaceState {
  sessions: Session[];
  activeId: string | null;
  nextNumber: number;
}

type WorkspaceAction =
  | { type: "add" }
  | { type: "select"; id: string }
  | { type: "close"; id: string }
  | { type: "status"; id: string; status: SessionStatus }
  | { type: "cwd"; id: string; cwd: string };

const INITIAL_STATE: WorkspaceState = {
  sessions: [
    { id: "session-1", name: "Terminal 1", status: "connecting", cwd: null },
  ],
  activeId: "session-1",
  nextNumber: 2,
};

function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "add": {
      const session: Session = {
        id: `session-${state.nextNumber}`,
        name: `Terminal ${state.nextNumber}`,
        status: "connecting",
        cwd: null,
      };
      return {
        sessions: [...state.sessions, session],
        activeId: session.id,
        nextNumber: state.nextNumber + 1,
      };
    }
    case "select":
      return state.sessions.some((session) => session.id === action.id)
        ? { ...state, activeId: action.id }
        : state;
    case "close": {
      const index = state.sessions.findIndex(
        (session) => session.id === action.id,
      );
      if (index === -1) return state;

      const sessions = state.sessions.filter(
        (session) => session.id !== action.id,
      );
      if (state.activeId !== action.id) return { ...state, sessions };

      const nextActive = sessions[index]?.id ?? sessions[index - 1]?.id ?? null;
      return { ...state, sessions, activeId: nextActive };
    }
    case "status":
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id
            ? { ...session, status: action.status }
            : session,
        ),
      };
    case "cwd":
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id ? { ...session, cwd: action.cwd } : session,
        ),
      };
  }
}

function cwdLabel(cwd: string | null): string {
  if (!cwd) return "Starting…";
  return cwd.replace(/[/\\]+$/, "") || "/";
}

type ServerMessage =
  | { type: "output"; data: string }
  | { type: "cwd"; cwd: string };

function parseServerMessage(data: string): ServerMessage | null {
  try {
    const message = JSON.parse(data) as Partial<ServerMessage>;
    if (message.type === "cwd" && typeof message.cwd === "string") {
      return message as ServerMessage;
    }
    if (message.type === "output" && typeof message.data === "string") {
      return message as ServerMessage;
    }
  } catch {
    // Keep compatibility with the previous raw PTY output protocol while a
    // dev server is being restarted after this client update.
    return { type: "output", data };
  }
  return null;
}

function disposeCore(core: TerminalCore): void {
  const disposable = core as TerminalCore & { dispose?: () => void };
  disposable.dispose?.();
}

function terminalPixelSize(terminal: WTerm): { width: number; height: number } {
  const rect = terminal.element.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

interface SessionTerminalProps {
  session: Session;
  active: boolean;
  debugEnabled: boolean;
  wasmUrl?: string;
  maxImageWidth?: number;
  maxImageHeight?: number;
  coreLoader?: () => Promise<TerminalCore>;
  onStatus: (id: string, status: SessionStatus) => void;
  onCwd: (id: string, cwd: string) => void;
}

function SessionTerminal({
  session,
  active,
  debugEnabled,
  wasmUrl,
  maxImageWidth,
  maxImageHeight,
  coreLoader,
  onStatus,
  onCwd,
}: SessionTerminalProps) {
  const [core, setCore] = useState<TerminalCore | null>(null);
  const { ref, write } = useTerminal();
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<WTerm | null>(null);
  const connectFrameRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      if (connectFrameRef.current !== null) {
        cancelAnimationFrame(connectFrameRef.current);
        connectFrameRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!coreLoader) return;

    let cancelled = false;
    onStatus(session.id, "loading");
    coreLoader()
      .then((loadedCore) => {
        if (cancelled) {
          disposeCore(loadedCore);
        } else {
          setCore(loadedCore);
        }
      })
      .catch(() => {
        if (!cancelled) onStatus(session.id, "closed");
      });

    return () => {
      cancelled = true;
    };
  }, [coreLoader, onStatus, session.id]);

  useEffect(() => {
    return () => {
      if (core) disposeCore(core);
    };
  }, [core]);

  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active, ref]);

  const handleReady = useCallback(
    (wt: WTerm) => {
      if (disposedRef.current || wsRef.current) return;
      terminalRef.current = wt;

      // Let the first ResizeObserver pass settle before spawning the shell.
      // Otherwise zsh starts at 80x24, then redraws its prompt when the
      // terminal immediately resizes to the viewport dimensions.
      connectFrameRef.current = requestAnimationFrame(() => {
        connectFrameRef.current = null;
        if (disposedRef.current || wsRef.current) return;

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${proto}//${window.location.host}/api/terminal`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        onStatus(session.id, "connecting");

        ws.onopen = () => {
          const { width, height } = terminalPixelSize(wt);
          ws.send(`\x1b[RESIZE:${wt.cols};${wt.rows};${width};${height}]`);
          onStatus(session.id, "connected");
        };

        ws.onmessage = (event: MessageEvent) => {
          const message = parseServerMessage(event.data as string);
          if (!message) return;
          if (message.type === "cwd") {
            onCwd(session.id, message.cwd);
          } else {
            write(message.data);
          }
        };

        ws.onclose = () => {
          if (disposedRef.current) return;
          write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
          wsRef.current = null;
          onStatus(session.id, "closed");
        };
      });
    },
    [onCwd, onStatus, session.id, write],
  );

  const handleData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const terminal = terminalRef.current;
      if (!terminal) return;
      const { width, height } = terminalPixelSize(terminal);
      wsRef.current.send(`\x1b[RESIZE:${cols};${rows};${width};${height}]`);
    }
  }, []);

  if (coreLoader && !core) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-xs text-white/35">
        Loading terminal…
      </div>
    );
  }

  return (
    <WTermTerminal
      ref={ref}
      cols={80}
      rows={24}
      autoResize
      debug={debugEnabled}
      wasmUrl={wasmUrl}
      maxImageWidth={maxImageWidth}
      maxImageHeight={maxImageHeight}
      core={core ?? undefined}
      onReady={handleReady}
      onData={handleData}
      onResize={handleResize}
      tabIndex={active ? 0 : -1}
      className="local-terminal h-full w-full"
      style={
        {
          borderRadius: 0,
          boxShadow: "none",
          padding: 0,
          backgroundColor: "#000",
          "--term-bg": "#000",
        } as CSSProperties
      }
    />
  );
}

interface SessionWorkspaceProps {
  wasmUrl?: string;
  maxImageWidth?: number;
  maxImageHeight?: number;
  coreLoader?: () => Promise<TerminalCore>;
}

export function SessionWorkspace({
  wasmUrl,
  maxImageWidth,
  maxImageHeight,
  coreLoader,
}: SessionWorkspaceProps) {
  const [workspace, dispatch] = useReducer(workspaceReducer, INITIAL_STATE);
  const [debugEnabled] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("debug"),
  );

  const handleStatus = useCallback((id: string, status: SessionStatus) => {
    dispatch({ type: "status", id, status });
  }, []);

  const handleCwd = useCallback((id: string, cwd: string) => {
    dispatch({ type: "cwd", id, cwd });
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-black text-[#ededed]">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[#1f1f1f] bg-[#0a0a0a]">
        <div className="flex h-14 shrink-0 items-center border-b border-[#1f1f1f] px-3">
          <span className="text-sm font-medium tracking-tight text-[#ededed]">
            Local Shell
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: "add" })}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-md p-0 text-[#888] transition-colors hover:bg-[#1f1f1f] hover:text-white"
            aria-label="New terminal session"
            title="New terminal session"
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-2 py-4"
          aria-label="Terminal sessions"
        >
          <div className="px-2 pb-2 text-xs text-[#888]">Sessions</div>

          {workspace.sessions.map((session) => {
            const selected = session.id === workspace.activeId;
            return (
              <div
                key={session.id}
                className={`group mb-0.5 flex h-8 items-center rounded-md transition-colors ${
                  selected ? "bg-[#2e2e2e]" : "hover:bg-[#242424]"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => dispatch({ type: "select", id: session.id })}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      session.status === "connected"
                        ? "bg-emerald-400"
                        : session.status === "closed"
                          ? "bg-[#666]"
                          : "bg-[#f5a623]"
                    }`}
                    aria-hidden="true"
                  />
                  <span
                    className="truncate"
                    title={session.cwd ?? session.name}
                  >
                    {cwdLabel(session.cwd)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "close", id: session.id })}
                  className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#666] opacity-0 transition-opacity hover:bg-[#3a3a3a] hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Close ${session.name}`}
                  title={`Close ${session.name}`}
                >
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            );
          })}

          {workspace.sessions.length === 0 && (
            <div className="px-2 py-4 text-xs leading-relaxed text-[#666]">
              No sessions open.
              <br />
              Use + to start one.
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 bg-black p-4">
        <div className="relative h-full min-w-0 overflow-hidden">
          {workspace.sessions.map((session) => {
            const active = session.id === workspace.activeId;
            return (
              <div
                key={session.id}
                className="absolute inset-0"
                style={{ visibility: active ? "visible" : "hidden" }}
                aria-hidden={!active}
                inert={!active}
                role="tabpanel"
                aria-label={session.name}
              >
                <SessionTerminal
                  session={session}
                  active={active}
                  debugEnabled={debugEnabled}
                  wasmUrl={wasmUrl}
                  maxImageWidth={maxImageWidth}
                  maxImageHeight={maxImageHeight}
                  coreLoader={coreLoader}
                  onStatus={handleStatus}
                  onCwd={handleCwd}
                />
              </div>
            );
          })}

          {workspace.sessions.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-white/35">
              <button
                type="button"
                onClick={() => dispatch({ type: "add" })}
                className="rounded-md border border-[#2e2e2e] px-3 py-2 text-xs text-[#a1a1a1] hover:bg-[#1c1c1c] hover:text-white"
              >
                New terminal session
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
