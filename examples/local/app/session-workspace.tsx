"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  Rows2,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Terminal as WTermTerminal, useTerminal } from "@wterm/react";
import type { SearchState, TerminalCore, WTerm } from "@wterm/dom";
import { OutputReader } from "./output-reader";
import {
  ClipboardRequest,
  type ClipboardWriteRequest,
} from "./clipboard-request";
import { TerminalConnection } from "../lib/terminal-connection";
import "@wterm/react/css";

import {
  INITIAL_STATE,
  MAX_PANES,
  adjacentPane,
  measureLayout,
  minimumSize,
  workspaceReducer,
  visibleSessions,
  type Session,
  type SessionStatus,
} from "../lib/workspace-layout";
import { PaneDivider } from "./pane-divider";

function cwdLabel(cwd: string | null): string {
  if (!cwd) return "Starting…";
  return cwd.replace(/[/\\]+$/, "") || "/";
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
  visible: boolean;
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
  visible,
  debugEnabled,
  wasmUrl,
  maxImageWidth,
  maxImageHeight,
  coreLoader,
  onStatus,
  onCwd,
}: SessionTerminalProps) {
  const [ready, setReady] = useState(false);
  const focusedRequest = useRef(0);
  const [core, setCore] = useState<TerminalCore | null>(null);
  const { ref, write } = useTerminal();
  const wsRef = useRef<TerminalConnection | null>(null);
  const terminalRef = useRef<WTerm | null>(null);
  const connectFrameRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const [findOpen, setFindOpen] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [reconnected, setReconnected] = useState(false);
  const [lostInput, setLostInput] = useState(false);
  const [announceOutput, setAnnounceOutput] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const openFind = useCallback(() => {
    setFindOpen(true);
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  const closeFind = () => {
    setFindOpen(false);
    terminalRef.current?.clearSearch();
    terminalRef.current?.focus();
  };

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("dialog[open]")
      )
        return;
      if (
        event.key.toLowerCase() === "f" &&
        !event.altKey &&
        ((event.metaKey && !event.ctrlKey) ||
          (event.ctrlKey && event.shiftKey && !event.metaKey))
      ) {
        event.preventDefault();
        event.stopPropagation();
        openFind();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, openFind]);

  useEffect(() => {
    if (findOpen) terminalRef.current?.search(query, { caseSensitive });
  }, [query, caseSensitive, findOpen]);

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
    if (!ready || focusedRequest.current === session.focusRequest) return;
    focusedRequest.current = session.focusRequest;
    if (!active || document.querySelector("dialog[open]")) return;
    terminalRef.current?.element.closest('[role="tabpanel"]')?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
    if (findOpen) findInputRef.current?.focus();
    else ref.current?.focus();
  }, [active, findOpen, ready, ref, session.focusRequest]);

  useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);

  const handleReady = useCallback(
    (wt: WTerm) => {
      if (disposedRef.current) return;
      // A new parser cannot resume from the previous parser's byte position.
      if (terminalRef.current && terminalRef.current !== wt) {
        wsRef.current?.close();
        wsRef.current = null;
      }
      terminalRef.current = wt;
      setReady(true);
      wt.onSearchChange = setSearchState;
      if (wsRef.current) return;

      // Let the first ResizeObserver pass settle before spawning the shell.
      // Otherwise zsh starts at 80x24, then redraws its prompt when the
      // terminal immediately resizes to the viewport dimensions.
      connectFrameRef.current = requestAnimationFrame(() => {
        connectFrameRef.current = null;
        if (disposedRef.current || wsRef.current) return;

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${proto}//${window.location.host}/api/terminal`;
        onStatus(session.id, "connecting");
        const connection = new TerminalConnection(() => new WebSocket(wsUrl), {
          open: (resumed, inputLost) => {
            const terminal = terminalRef.current;
            if (!terminal) return;
            const { width, height } = terminalPixelSize(terminal);
            setConnectionMessage(null);
            setReconnected(resumed);
            setLostInput((previous) => inputLost || (resumed && previous));
            onStatus(session.id, "connected");
            connection.resize(terminal.cols, terminal.rows, width, height);
          },
          reconnecting: () => {
            setReconnected(false);
            setConnectionMessage(
              "Reconnecting… Input is paused until the session returns.",
            );
            onStatus(session.id, "reconnecting");
          },
          write: (data) => write(data),
          cwd: (path) => onCwd(session.id, path),
          end: (message) => {
            if (disposedRef.current || wsRef.current !== connection) return;
            setConnectionMessage(message);
            setReconnected(false);
            wsRef.current = null;
            onStatus(session.id, "closed");
          },
          inputError: setConnectionMessage,
        });
        wsRef.current = connection;
      });
    },
    [onCwd, onStatus, session.id, write],
  );

  const handleData = useCallback((data: string) => {
    wsRef.current?.input(data);
  }, []);

  const [clipboardRequest, setClipboardRequest] =
    useState<ClipboardWriteRequest | null>(null);
  const handleClipboardWrite = useCallback((text: string) => {
    setClipboardRequest({ text });
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const { width, height } = terminalPixelSize(terminal);
    wsRef.current?.resize(cols, rows, width, height);
  }, []);

  if (coreLoader && !core) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-xs text-white/35">
        Loading terminal…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-[#1f1f1f] pb-2 text-xs">
        <OutputReader
          terminal={terminalRef}
          name={session.name}
          active={visible}
        />
        <label className="flex items-center gap-2 px-2 py-1 text-[#aaa]">
          <input
            type="checkbox"
            checked={announceOutput}
            onChange={(event) => setAnnounceOutput(event.target.checked)}
          />
          Announce output
        </label>
        {findOpen ? (
          <div
            className="flex min-w-0 basis-full items-center gap-2"
            role="search"
            aria-label="Terminal output"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                closeFind();
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) terminalRef.current?.findPrevious();
                else terminalRef.current?.findNext();
              }
            }}
          >
            <input
              ref={findInputRef}
              type="text"
              aria-label="Find in terminal"
              placeholder="Find in terminal…"
              maxLength={1024}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 rounded border border-[#444] bg-[#161616] px-2 py-1 outline-none focus:border-[#999]"
            />
            <span
              className="whitespace-nowrap text-[#aaa]"
              role="status"
              aria-live="polite"
            >
              {!query
                ? ""
                : searchState?.searching
                  ? "Searching…"
                  : searchState?.count
                    ? `${searchState.activeIndex + 1} of ${searchState.count}${searchState.limited ? "+" : ""}`
                    : "No matches"}
            </span>
            <button
              type="button"
              aria-label="Match case"
              aria-pressed={caseSensitive}
              title="Match case"
              onClick={() => setCaseSensitive((value) => !value)}
              className={`rounded px-2 py-1 ${caseSensitive ? "bg-[#444] text-white" : "text-[#aaa] hover:bg-[#222]"}`}
            >
              Aa
            </button>
            <button
              type="button"
              aria-label="Previous match"
              title="Previous match (Shift+Enter)"
              disabled={!searchState?.count}
              className="rounded p-1 hover:bg-[#222] disabled:opacity-30"
              onClick={() => terminalRef.current?.findPrevious()}
            >
              <ArrowUp size={16} />
            </button>
            <button
              type="button"
              aria-label="Next match"
              title="Next match (Enter)"
              disabled={!searchState?.count}
              className="rounded p-1 hover:bg-[#222] disabled:opacity-30"
              onClick={() => terminalRef.current?.findNext()}
            >
              <ArrowDown size={16} />
            </button>
            <button
              type="button"
              aria-label="Close find"
              title="Close find (Escape)"
              className="rounded p-1 hover:bg-[#222]"
              onClick={closeFind}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openFind}
            title="Find in terminal (⌘F / Ctrl+Shift+F)"
            className="ml-auto flex items-center gap-2 rounded px-2 py-1 text-[#aaa] hover:bg-[#222] hover:text-white"
          >
            <Search size={14} />
            Find
          </button>
        )}
      </div>
      {(reconnected || lostInput) && (
        <div
          role="status"
          className="flex items-center gap-3 py-2 text-xs text-[#aaa]"
        >
          <span>
            {reconnected && "Reconnected."}
            {lostInput &&
              " Some input did not reach the shell and was not resent. Check the command line before continuing."}
          </span>
          <button
            type="button"
            className="shrink-0 underline hover:text-white"
            onClick={() => {
              setReconnected(false);
              setLostInput(false);
              terminalRef.current?.focus();
            }}
            aria-label="Dismiss reconnection notice"
          >
            Dismiss
          </button>
        </div>
      )}
      {connectionMessage && (
        <p role="status" className="shrink-0 px-2 py-1 text-xs text-[#aaa]">
          {connectionMessage}
        </p>
      )}
      <ClipboardRequest
        request={clipboardRequest}
        dismiss={(request) =>
          setClipboardRequest((current) =>
            current === request ? null : current,
          )
        }
        terminal={terminalRef}
        name={session.name}
        active={visible}
      />
      <div className="min-h-0 flex-1 pt-2" inert={!ready}>
        <WTermTerminal
          ref={ref}
          renderingPaused={!visible}
          announceOutput={active && announceOutput}
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
          onClipboardWrite={handleClipboardWrite}
          onResize={handleResize}
          aria-label={session.name}
          tabIndex={visible ? 0 : -1}
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
      </div>
    </div>
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

  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const measure = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const displayLayout =
    workspace.zoomed && workspace.activeId
      ? { kind: "pane" as const, session: workspace.activeId }
      : workspace.layout;
  const minimum = minimumSize(displayLayout);
  const width = Math.max(size.width, minimum.width);
  const height = Math.max(size.height, minimum.height);
  const { panes, dividers } = measureLayout(displayLayout, width, height);
  const paneCount = Object.keys(panes).length;
  const layoutPaneCount = visibleSessions(workspace.layout).length;

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

      <main
        className="min-h-0 min-w-0 flex-1 bg-black p-4"
        onKeyDownCapture={(event) => {
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.getModifierState("AltGraph") ||
            !event.altKey ||
            event.shiftKey ||
            event.ctrlKey === event.metaKey ||
            !(event.target instanceof Element) ||
            !event.target.closest(".local-terminal") ||
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            ) ||
            !workspace.activeId ||
            paneCount < 2
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const next = adjacentPane(
            panes,
            workspace.activeId,
            event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
          );
          if (next) dispatch({ type: "select", id: next });
        }}
      >
        <div ref={viewportRef} className="h-full w-full overflow-auto">
          <div className="relative" style={{ width, height }}>
            {workspace.sessions.map((session) => {
              const active = session.id === workspace.activeId;
              const rect = panes[session.id];
              const visible = !!rect;
              return (
                <div
                  key={session.id}
                  id={`pane-${session.id}`}
                  className={`absolute flex min-h-0 min-w-0 flex-col overflow-hidden rounded border ${paneCount > 1 ? (active ? "border-[#888]" : "border-[#333]") : "border-transparent"}`}
                  style={{
                    ...(rect ?? { left: 0, top: 0, width, height }),
                    visibility: visible ? "visible" : "hidden",
                  }}
                  aria-hidden={!visible}
                  inert={!visible}
                  role="tabpanel"
                  aria-label={session.name}
                  onFocusCapture={() =>
                    dispatch({ type: "focus", id: session.id })
                  }
                  onPointerDownCapture={() =>
                    dispatch({ type: "focus", id: session.id })
                  }
                >
                  <div className="flex h-8 shrink-0 items-center gap-1 px-2 text-xs text-[#aaa]">
                    <button
                      type="button"
                      className="min-w-0 truncate text-left hover:text-white"
                      onClick={() =>
                        dispatch({ type: "select", id: session.id })
                      }
                      aria-label={`Focus ${session.name}`}
                      title="Focus pane (⌘⌥ arrows / Ctrl+Alt+arrows in terminal input)"
                    >
                      {session.name}
                    </button>
                    <span className="ml-auto" />
                    <button
                      type="button"
                      aria-label="Split right"
                      title={
                        layoutPaneCount >= MAX_PANES
                          ? "This layout already has four panes"
                          : "Split right"
                      }
                      disabled={layoutPaneCount >= MAX_PANES}
                      className="rounded p-1 hover:bg-[#222] hover:text-white disabled:opacity-30"
                      onClick={() =>
                        dispatch({
                          type: "split",
                          id: session.id,
                          direction: "right",
                        })
                      }
                    >
                      <Columns2 size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Split down"
                      title={
                        layoutPaneCount >= MAX_PANES
                          ? "This layout already has four panes"
                          : "Split down"
                      }
                      disabled={layoutPaneCount >= MAX_PANES}
                      className="rounded p-1 hover:bg-[#222] hover:text-white disabled:opacity-30"
                      onClick={() =>
                        dispatch({
                          type: "split",
                          id: session.id,
                          direction: "down",
                        })
                      }
                    >
                      <Rows2 size={14} aria-hidden="true" />
                    </button>
                    {layoutPaneCount > 1 && (
                      <button
                        type="button"
                        aria-label={
                          workspace.zoomed ? "Restore panes" : "Zoom pane"
                        }
                        title={
                          workspace.zoomed
                            ? "Restore panes"
                            : "Zoom pane; other sessions stay open"
                        }
                        className="rounded p-1 hover:bg-[#222] hover:text-white"
                        onClick={() =>
                          dispatch({ type: "zoom", id: session.id })
                        }
                      >
                        {workspace.zoomed ? (
                          <Minimize2 size={14} aria-hidden="true" />
                        ) : (
                          <Maximize2 size={14} aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 px-2 pb-2">
                    <SessionTerminal
                      session={session}
                      active={active}
                      visible={visible}
                      debugEnabled={debugEnabled}
                      wasmUrl={wasmUrl}
                      maxImageWidth={maxImageWidth}
                      maxImageHeight={maxImageHeight}
                      coreLoader={coreLoader}
                      onStatus={handleStatus}
                      onCwd={handleCwd}
                    />
                  </div>
                </div>
              );
            })}
            {dividers.map((divider) => (
              <PaneDivider
                key={divider.id}
                divider={divider}
                onResize={(id, ratio) =>
                  dispatch({ type: "resize", id, ratio })
                }
              />
            ))}

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
        </div>
      </main>
    </div>
  );
}
