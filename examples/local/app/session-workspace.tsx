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
import type {
  SearchState,
  TerminalCore,
  WTerm,
  ShellIntegrationState,
} from "@wterm/dom";
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
  shellLabel,
  type Session,
  type SessionStatus,
} from "../lib/workspace-layout";
import { PaneDivider } from "./pane-divider";
import { AppearanceSettings, useAppearance } from "./appearance-settings";
import { TERMINAL_COLORS } from "../lib/appearance";
import { ShortcutSettings, useShortcuts } from "./shortcut-settings";
import {
  ariaShortcuts,
  matchCommand,
  shortcutTitle,
  type Shortcuts,
} from "../lib/shortcuts";

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
  shortcuts: Shortcuts;
  registerFind: (id: string, open: () => void) => () => void;
  theme: "dark" | "light";
  fontSize: number;
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
  onShell: (id: string, state: ShellIntegrationState) => void;
}

function SessionTerminal({
  shortcuts,
  registerFind,
  theme,
  fontSize,
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
  onShell,
}: SessionTerminalProps) {
  const [ready, setReady] = useState(false);
  const themeRef = useRef(theme);
  useLayoutEffect(() => {
    themeRef.current = theme;
  }, [theme]);
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

  useLayoutEffect(() => {
    terminalRef.current?.setThemeColors(TERMINAL_COLORS[theme]);
  }, [theme, ready]);

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

  useLayoutEffect(
    () => registerFind(session.id, openFind),
    [registerFind, session.id, openFind],
  );

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
      wt.setThemeColors(TERMINAL_COLORS[themeRef.current]);
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
      <div className="flex h-full items-center justify-center bg-[var(--workspace-bg)] text-xs text-[var(--workspace-muted)]">
        Loading terminal…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--workspace-border)] pb-2 text-xs">
        <OutputReader
          terminal={terminalRef}
          name={session.name}
          active={visible}
        />
        <label className="flex items-center gap-2 px-2 py-1 text-[var(--workspace-muted)]">
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
              className="min-w-0 flex-1 rounded border border-[var(--workspace-border)] bg-[var(--workspace-bg)] px-2 py-1 outline-none focus:border-[var(--workspace-focus)]"
            />
            <span
              className="whitespace-nowrap text-[var(--workspace-muted)]"
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
              className={`rounded px-2 py-1 ${caseSensitive ? "bg-[var(--workspace-selected)] text-[var(--workspace-fg)]" : "text-[var(--workspace-muted)] hover:bg-[var(--workspace-hover)]"}`}
            >
              Aa
            </button>
            <button
              type="button"
              aria-label="Previous match"
              title="Previous match (Shift+Enter)"
              disabled={!searchState?.count}
              className="rounded p-1 hover:bg-[var(--workspace-hover)] disabled:opacity-30"
              onClick={() => terminalRef.current?.findPrevious()}
            >
              <ArrowUp size={16} />
            </button>
            <button
              type="button"
              aria-label="Next match"
              title="Next match (Enter)"
              disabled={!searchState?.count}
              className="rounded p-1 hover:bg-[var(--workspace-hover)] disabled:opacity-30"
              onClick={() => terminalRef.current?.findNext()}
            >
              <ArrowDown size={16} />
            </button>
            <button
              type="button"
              aria-label="Close find"
              title="Close find (Escape)"
              className="rounded p-1 hover:bg-[var(--workspace-hover)]"
              onClick={closeFind}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openFind}
            title={shortcutTitle(shortcuts, "find", "Find in terminal")}
            aria-keyshortcuts={ariaShortcuts(shortcuts, "find")}
            className="ml-auto flex items-center gap-2 rounded px-2 py-1 text-[var(--workspace-muted)] hover:bg-[var(--workspace-hover)] hover:text-[var(--workspace-fg)]"
          >
            <Search size={14} />
            Find
          </button>
        )}
      </div>
      {(reconnected || lostInput) && (
        <div
          role="status"
          className="flex items-center gap-3 py-2 text-xs text-[var(--workspace-muted)]"
        >
          <span>
            {reconnected && "Reconnected."}
            {lostInput &&
              " Some input did not reach the shell and was not resent. Check the command line before continuing."}
          </span>
          <button
            type="button"
            className="shrink-0 underline hover:text-[var(--workspace-fg)]"
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
        <p
          role="status"
          className="shrink-0 px-2 py-1 text-xs text-[var(--workspace-muted)]"
        >
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
          onShellIntegration={(state) => onShell(session.id, state)}
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
              "--term-font-size": `${fontSize}px`,
              "--term-row-height": `${Math.ceil(fontSize * 1.2)}px`,
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
  const {
    shortcuts,
    saved: shortcutsSaved,
    update: updateShortcuts,
  } = useShortcuts();
  const findHandlers = useRef(new Map<string, () => void>());
  const registerFind = useCallback((id: string, open: () => void) => {
    findHandlers.current.set(id, open);
    return () => {
      findHandlers.current.delete(id);
    };
  }, []);
  const composing = useRef(false);
  const consumedKeys = useRef(new Set<string>());
  const newSessionButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const blur = () => {
      composing.current = false;
      consumedKeys.current.clear();
    };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, []);
  useEffect(() => {
    if (!workspace.sessions.length) newSessionButton.current?.focus();
  }, [workspace.sessions.length]);
  const {
    appearance,
    theme,
    ready: appearanceReady,
    saved,
    update,
  } = useAppearance();
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

  const handleShell = useCallback(
    (id: string, shell: ShellIntegrationState) => {
      dispatch({ type: "shell", id, shell });
    },
    [],
  );

  return (
    <div
      data-theme={appearanceReady ? theme : "system"}
      className="workspace flex h-screen w-screen overflow-hidden bg-[var(--workspace-bg)] text-[var(--workspace-fg)]"
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
      onKeyUpCapture={(event) => {
        if (consumedKeys.current.delete(event.code)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.repeat && consumedKeys.current.has(event.code)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!event.repeat) consumedKeys.current.delete(event.code);
        if (
          event.repeat ||
          composing.current ||
          event.defaultPrevented ||
          !(event.target instanceof Element) ||
          document.querySelector("dialog[open]")
        )
          return;
        const command = matchCommand(shortcuts, event.nativeEvent);
        if (!command) return;
        const terminalInput = !!event.target.closest(".local-terminal");
        const editing = !!event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        );
        if (
          !terminalInput &&
          (editing || (command !== "find" && command !== "new"))
        )
          return;
        const id = workspace.activeId;
        if (command !== "new" && !id) return;
        event.preventDefault();
        event.stopPropagation();
        consumedKeys.current.add(event.code);
        switch (command) {
          case "new":
            dispatch({ type: "add" });
            break;
          case "close":
            dispatch({ type: "close", id: id! });
            break;
          case "splitRight":
          case "splitDown":
            dispatch({
              type: "split",
              id: id!,
              direction: command === "splitRight" ? "right" : "down",
            });
            break;
          case "zoom":
            if (layoutPaneCount > 1) dispatch({ type: "zoom", id: id! });
            break;
          case "find":
            findHandlers.current.get(id!)?.();
            break;
          default: {
            const direction = {
              left: "ArrowLeft",
              right: "ArrowRight",
              up: "ArrowUp",
              down: "ArrowDown",
            } as const;
            const next = adjacentPane(panes, id!, direction[command]);
            if (next) dispatch({ type: "select", id: next });
          }
        }
      }}
    >
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--workspace-border)] bg-[var(--workspace-sidebar)]">
        <div className="flex h-14 shrink-0 items-center border-b border-[var(--workspace-border)] px-3">
          <span className="text-sm font-medium tracking-tight text-[var(--workspace-fg)]">
            Local Shell
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: "add" })}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-md p-0 text-[var(--workspace-muted)] transition-colors hover:bg-[var(--workspace-border)] hover:text-[var(--workspace-fg)]"
            aria-label="New terminal session"
            ref={newSessionButton}
            title={shortcutTitle(shortcuts, "new", "New terminal session")}
            aria-keyshortcuts={ariaShortcuts(shortcuts, "new")}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-2 py-4"
          aria-label="Terminal sessions"
        >
          <div className="px-2 pb-2 text-xs text-[var(--workspace-muted)]">
            Sessions
          </div>

          {workspace.sessions.map((session) => {
            const selected = session.id === workspace.activeId;
            return (
              <div
                key={session.id}
                className={`group mb-0.5 flex h-8 items-center rounded-md transition-colors ${
                  selected
                    ? "bg-[var(--workspace-selected)]"
                    : "hover:bg-[var(--workspace-hover)]"
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
                        ? "bg-[var(--workspace-connected)]"
                        : session.status === "closed"
                          ? "bg-[#666]"
                          : "bg-[var(--workspace-pending)]"
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
                {shellLabel(session) && (
                  <span
                    className="mr-2 shrink-0 text-[10px] text-[var(--workspace-muted)]"
                    title={`${session.name}: ${shellLabel(session)}`}
                  >
                    {shellLabel(session)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => dispatch({ type: "close", id: session.id })}
                  className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--workspace-muted)] opacity-0 transition-opacity hover:bg-[var(--workspace-hover)] hover:text-[var(--workspace-fg)] group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Close ${session.name}`}
                  title={
                    selected
                      ? shortcutTitle(
                          shortcuts,
                          "close",
                          `Close ${session.name}`,
                        )
                      : `Close ${session.name}`
                  }
                  aria-keyshortcuts={
                    selected ? ariaShortcuts(shortcuts, "close") : undefined
                  }
                >
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            );
          })}

          {workspace.sessions.length === 0 && (
            <div className="px-2 py-4 text-xs leading-relaxed text-[var(--workspace-muted)]">
              No sessions open.
              <br />
              Use + to start one.
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-[var(--workspace-border)] p-2">
          <ShortcutSettings
            shortcuts={shortcuts}
            saved={shortcutsSaved}
            update={updateShortcuts}
          />
          <AppearanceSettings
            appearance={appearance}
            saved={saved}
            update={update}
          />
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 bg-[var(--workspace-bg)] p-4">
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
                  className={`absolute flex min-h-0 min-w-0 flex-col overflow-hidden rounded border ${paneCount > 1 ? (active ? "border-[var(--workspace-focus)]" : "border-[var(--workspace-border)]") : "border-transparent"}`}
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
                  <div className="flex h-8 shrink-0 items-center gap-1 px-2 text-xs text-[var(--workspace-muted)]">
                    <button
                      type="button"
                      className="min-w-0 truncate text-left hover:text-[var(--workspace-fg)]"
                      onClick={() =>
                        dispatch({ type: "select", id: session.id })
                      }
                      aria-label={`Focus ${session.name}`}
                      title="Focus pane"
                    >
                      {session.name}
                    </button>
                    {shellLabel(session) && (
                      <span
                        className="ml-2 shrink-0 rounded bg-[var(--workspace-hover)] px-2 py-0.5"
                        title="Reported by shell integration"
                      >
                        {shellLabel(session)}
                      </span>
                    )}
                    <span className="ml-auto" />
                    <button
                      type="button"
                      aria-label="Split right"
                      title={
                        layoutPaneCount >= MAX_PANES
                          ? "This layout already has four panes"
                          : shortcutTitle(
                              shortcuts,
                              "splitRight",
                              "Split right",
                            )
                      }
                      aria-keyshortcuts={
                        active
                          ? ariaShortcuts(shortcuts, "splitRight")
                          : undefined
                      }
                      disabled={layoutPaneCount >= MAX_PANES}
                      className="rounded p-1 hover:bg-[var(--workspace-hover)] hover:text-[var(--workspace-fg)] disabled:opacity-30"
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
                          : shortcutTitle(shortcuts, "splitDown", "Split down")
                      }
                      aria-keyshortcuts={
                        active
                          ? ariaShortcuts(shortcuts, "splitDown")
                          : undefined
                      }
                      disabled={layoutPaneCount >= MAX_PANES}
                      className="rounded p-1 hover:bg-[var(--workspace-hover)] hover:text-[var(--workspace-fg)] disabled:opacity-30"
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
                        title={shortcutTitle(
                          shortcuts,
                          "zoom",
                          workspace.zoomed
                            ? "Restore panes"
                            : "Zoom pane; other sessions stay open",
                        )}
                        aria-keyshortcuts={
                          active ? ariaShortcuts(shortcuts, "zoom") : undefined
                        }
                        className="rounded p-1 hover:bg-[var(--workspace-hover)] hover:text-[var(--workspace-fg)]"
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
                    {appearanceReady && (
                      <SessionTerminal
                        shortcuts={shortcuts}
                        registerFind={registerFind}
                        theme={theme}
                        fontSize={appearance.fontSize}
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
                        onShell={handleShell}
                      />
                    )}
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
              <div className="flex h-full items-center justify-center text-sm text-[var(--workspace-muted)]">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "add" })}
                  className="rounded-md border border-[var(--workspace-border)] px-3 py-2 text-xs text-[var(--workspace-muted)] hover:bg-[var(--workspace-hover)] hover:text-[var(--workspace-fg)]"
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
