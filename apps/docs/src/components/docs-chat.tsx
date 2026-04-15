"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import { MarkdownRenderer } from "@wterm/markdown";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const STORAGE_KEY = "docs-chat-messages";

const DESKTOP_DEFAULT_WIDTH = 400;
const DESKTOP_MIN_WIDTH = 300;
const DESKTOP_MAX_WIDTH = 700;

const COOKIE_CHANGE = "docs-chat-cookie";

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
  window.dispatchEvent(new Event(COOKIE_CHANGE));
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(
    new RegExp(
      "(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)",
    ),
  );
  return match ? decodeURIComponent(match[1]) : undefined;
}

function subscribeCookies(cb: () => void) {
  window.addEventListener(COOKIE_CHANGE, cb);
  return () => window.removeEventListener(COOKIE_CHANGE, cb);
}

const subscribeNoop = () => () => {};
const returnTrue = () => true;
const returnFalse = () => false;

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, returnFalse);
}

function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, returnTrue, returnFalse);
}

// ---------------------------------------------------------------------------
// ChatShell — imperative shell that drives the terminal chat
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  "What is wterm?",
  "How do I use it with React?",
  "What themes are available?",
  "How does the WASM bridge work?",
  "How do I connect to a PTY backend?",
];

type ChatMessage = { role: "user" | "assistant"; content: string };

class ChatShell {
  private _write: ((data: string) => void) | null = null;
  private _messages: ChatMessage[] = [];
  private _line = "";
  private _cursor = 0;
  private _busy = false;
  private _history: string[] = [];
  private _historyPos = -1;
  private _abortController: AbortController | null = null;

  attach(write: (data: string) => void) {
    this._write = write;

    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._messages = parsed;
        }
      }
    } catch {
      /* ignore */
    }

    if (this._messages.length > 0) {
      write(
        "\x1b[2mConversation restored. Type \x1b[0m/clear\x1b[2m to start fresh.\x1b[0m\r\n\r\n",
      );
      this._showPrompt();
    } else {
      this._showWelcome();
    }
  }

  clear() {
    this._messages = [];
    this._line = "";
    this._cursor = 0;
    this._history = [];
    this._historyPos = -1;
    this._save();
    this._write?.("\x1b[3J\x1b[2J\x1b[H");
    this._showWelcome();
  }

  async handleInput(data: string) {
    if (!this._write) return;
    const w = this._write;

    if (this._busy) {
      if (data === "\x03") {
        this._abortController?.abort();
      }
      return;
    }

    if (data === "\r") {
      const query = this._line.trim();
      this._line = "";
      this._cursor = 0;
      w("\r\n");

      if (!query) {
        this._showPrompt();
        return;
      }

      if (query === "/clear") {
        this.clear();
        return;
      }

      let actualQuery = query;
      const num = parseInt(query, 10);
      if (
        num >= 1 &&
        num <= SUGGESTIONS.length &&
        query === String(num) &&
        this._messages.length === 0
      ) {
        actualQuery = SUGGESTIONS[num - 1];
        w(`\x1b[2m${actualQuery}\x1b[0m\r\n`);
      }

      this._history.push(actualQuery);
      this._historyPos = -1;
      this._busy = true;

      let fullText = "";
      const md = new MarkdownRenderer();

      try {
        this._messages.push({ role: "user", content: actualQuery });

        const uiMessages = this._messages.map((m, i) => ({
          id: `msg-${i}`,
          role: m.role,
          parts: [{ type: "text" as const, text: m.content }],
          createdAt: new Date().toISOString(),
        }));

        this._abortController = new AbortController();

        const response = await fetch("/api/docs-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: uiMessages }),
          signal: this._abortController.signal,
        });

        if (!response.ok) {
          const err = await response
            .json()
            .catch(() => ({ message: "Request failed" }));
          w(`\r\n\x1b[31m${err.message || "Error"}\x1b[0m\r\n`);
          this._messages.pop();
          this._busy = false;
          this._abortController = null;
          this._showPrompt();
          return;
        }

        w("\r\n");
        if (!response.body) {
          w("\r\n\x1b[31mNo response body\x1b[0m\r\n");
          this._messages.pop();
          this._busy = false;
          this._abortController = null;
          this._showPrompt();
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIdx;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);

            if (!line || line === ": ping" || line === "data: [DONE]") continue;

            const data = line.startsWith("data: ") ? line.slice(6) : null;
            if (!data) continue;

            try {
              const event = JSON.parse(data);

              switch (event.type) {
                case "text-delta": {
                  const delta = event.delta as string;
                  fullText += delta;
                  const rendered = md.push(delta);
                  if (rendered) w(rendered);
                  break;
                }
                case "tool-input-start": {
                  const name = event.toolName as string;
                  if (name === "readFile") {
                    w(`\x1b[2mReading...\x1b[0m`);
                  } else if (name === "bash") {
                    w(`\x1b[2mRunning...\x1b[0m`);
                  }
                  break;
                }
                case "tool-input-available": {
                  const name = event.toolName as string;
                  const input = event.input as Record<string, unknown>;
                  if (name === "readFile") {
                    const path =
                      String(input?.path || "")
                        .replace(/^\/workspace\//, "/")
                        .replace(/\.md$/, "")
                        .replace(/\/index$/, "") || "/";
                    w(`\r\x1b[K\x1b[2mReading ${path}\x1b[0m\r\n`);
                  } else if (name === "bash") {
                    const cmd = String(input?.command || "").slice(0, 60);
                    w(`\r\x1b[K\x1b[2m$ ${cmd}\x1b[0m\r\n`);
                  }
                  break;
                }
                case "error": {
                  const errText = event.errorText as string;
                  w(`\r\n\x1b[31m${errText}\x1b[0m\r\n`);
                  break;
                }
              }
            } catch {
              /* ignore malformed JSON */
            }
          }
        }

        const remaining = md.flush();
        if (remaining) w(remaining);

        this._messages.push({ role: "assistant", content: fullText });
        this._save();
        w("\r\n\r\n");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          if (fullText) {
            this._messages.push({ role: "assistant", content: fullText });
            this._save();
          } else {
            this._messages.pop();
          }
          w("\r\n");
        } else {
          const msg = err instanceof Error ? err.message : "Unknown error";
          w(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
          this._messages.pop();
        }
      } finally {
        this._busy = false;
        this._abortController = null;
        this._showPrompt();
      }
    } else if (data === "\x7f" || data === "\b") {
      if (this._cursor > 0) {
        const tail = this._line.slice(this._cursor);
        this._line = this._line.slice(0, this._cursor - 1) + tail;
        this._cursor--;
        w("\b" + tail + "\x1b[K");
        if (tail.length > 0) w(`\x1b[${tail.length}D`);
      }
    } else if (data === "\x1b[A") {
      if (!this._history.length) return;
      if (this._historyPos < 0) this._historyPos = this._history.length;
      if (this._historyPos > 0) {
        this._historyPos--;
        const entry = this._history[this._historyPos];
        w(`\r\x1b[1;32m>\x1b[0m \x1b[K${entry}`);
        this._line = entry;
        this._cursor = entry.length;
      }
    } else if (data === "\x1b[B") {
      if (this._historyPos < 0) return;
      this._historyPos++;
      if (this._historyPos >= this._history.length) {
        this._historyPos = -1;
        w(`\r\x1b[1;32m>\x1b[0m \x1b[K`);
        this._line = "";
        this._cursor = 0;
      } else {
        const entry = this._history[this._historyPos];
        w(`\r\x1b[1;32m>\x1b[0m \x1b[K${entry}`);
        this._line = entry;
        this._cursor = entry.length;
      }
    } else if (data === "\x1b[D") {
      if (this._cursor > 0) {
        this._cursor--;
        w("\x1b[D");
      }
    } else if (data === "\x1b[C") {
      if (this._cursor < this._line.length) {
        this._cursor++;
        w("\x1b[C");
      }
    } else if (data === "\x15") {
      if (this._line.length > 0) {
        if (this._cursor > 0) w(`\x1b[${this._cursor}D`);
        w("\x1b[K");
        this._line = "";
        this._cursor = 0;
      }
    } else if (data === "\x01") {
      if (this._cursor > 0) {
        w(`\x1b[${this._cursor}D`);
        this._cursor = 0;
      }
    } else if (data === "\x05") {
      if (this._cursor < this._line.length) {
        w(`\x1b[${this._line.length - this._cursor}C`);
        this._cursor = this._line.length;
      }
    } else if (data === "\x03") {
      this._line = "";
      this._cursor = 0;
      w("^C\r\n");
      this._showPrompt();
    } else if (data === "\x0c") {
      w("\x1b[2J\x1b[H");
      this._showPrompt();
      w(this._line);
      if (this._cursor < this._line.length) {
        w(`\x1b[${this._line.length - this._cursor}D`);
      }
    } else if (data.length === 1 && data >= " ") {
      const tail = this._line.slice(this._cursor);
      this._line = this._line.slice(0, this._cursor) + data + tail;
      this._cursor++;
      if (tail.length === 0) {
        w(data);
      } else {
        w(data + tail + "\x1b[K");
        w(`\x1b[${tail.length}D`);
      }
    } else if (data.length > 1) {
      for (const ch of data) {
        await this.handleInput(ch);
      }
    }
  }

  private _showWelcome() {
    const w = this._write!;
    w("\r\n");
    SUGGESTIONS.forEach((s, i) => {
      w(`  \x1b[36m${i + 1}\x1b[0m  ${s}\r\n`);
    });
    w("\r\n");
    this._showPrompt();
  }

  private _showPrompt() {
    this._write!("\x1b[1;32m>\x1b[0m ");
  }

  private _save() {
    try {
      if (this._messages.length === 0) {
        sessionStorage.removeItem(STORAGE_KEY);
      } else {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this._messages));
      }
    } catch {
      /* ignore quota errors */
    }
  }
}

// ---------------------------------------------------------------------------
// ChatTerminal — React wrapper for Terminal + ChatShell
// ---------------------------------------------------------------------------

function ChatTerminal() {
  const { ref, write } = useTerminal();
  const shellRef = useRef<ChatShell | null>(null);

  const handleReady = useCallback(() => {
    const shell = new ChatShell();
    shellRef.current = shell;
    shell.attach(write);
  }, [write]);

  const handleData = useCallback((data: string) => {
    shellRef.current?.handleInput(data);
  }, []);

  return (
    <Terminal
      ref={ref}
      autoResize
      wasmUrl="/wterm.wasm"
      onReady={handleReady}
      onData={handleData}
      className="wterm-chat h-full"
    />
  );
}

// ---------------------------------------------------------------------------
// DocsChat — panel wrapper (aside on desktop, Sheet on mobile)
// ---------------------------------------------------------------------------

function useCookieState(
  name: string,
  serverDefault: string,
): [string, (v: string) => void] {
  const getSnapshot = useCallback(
    () => readCookie(name) ?? serverDefault,
    [name, serverDefault],
  );
  const getServerSnapshot = useCallback(() => serverDefault, [serverDefault]);
  const value = useSyncExternalStore(
    subscribeCookies,
    getSnapshot,
    getServerSnapshot,
  );
  const setValue = useCallback((v: string) => writeCookie(name, v), [name]);
  return [value, setValue];
}

export function DocsChat() {
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const hasMounted = useMounted();

  const [openStr, setOpenStr] = useCookieState("docs-chat-open", "false");
  const [widthStr, setWidthStr] = useCookieState(
    "docs-chat-width",
    String(DESKTOP_DEFAULT_WIDTH),
  );

  const open = openStr === "true";
  const desktopWidth = Math.min(
    DESKTOP_MAX_WIDTH,
    Math.max(DESKTOP_MIN_WIDTH, Number(widthStr) || DESKTOP_DEFAULT_WIDTH),
  );

  const [hasBeenOpened, setHasBeenOpened] = useState(false);
  const showTerminal = open || hasBeenOpened;
  const isDraggingRef = useRef(false);

  const updateOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const current = readCookie("docs-chat-open") === "true";
      const val = typeof next === "function" ? next(current) : next;
      setOpenStr(String(val));
      if (val) setHasBeenOpened(true);
    },
    [setOpenStr],
  );

  const updateDesktopWidth = useCallback(
    (next: number) => setWidthStr(String(next)),
    [setWidthStr],
  );

  // Keyboard: Cmd/Ctrl+I toggles panel, Escape closes desktop panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "i" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        updateOpen((prev: boolean) => !prev);
      }
      if (e.key === "Escape" && isDesktop) {
        updateOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [updateOpen, isDesktop]);

  // Body padding for desktop aside
  useEffect(() => {
    const body = document.body;
    if (isDesktop && open) {
      body.style.paddingRight = `${desktopWidth}px`;
      if (!isDraggingRef.current) {
        body.style.transition = "padding-right 150ms ease";
      }
    } else if (isDesktop) {
      body.style.paddingRight = "0px";
      body.style.transition = "padding-right 150ms ease";
    }
    return () => {
      body.style.paddingRight = "0px";
      body.style.transition = "";
    };
  }, [isDesktop, open, desktopWidth]);

  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      isDraggingRef.current = true;
      document.documentElement.style.transition = "none";
      const startX = e.clientX;
      const startWidth = desktopWidth;

      const onPointerMove = (ev: globalThis.PointerEvent) => {
        const delta = startX - ev.clientX;
        const newWidth = Math.min(
          DESKTOP_MAX_WIDTH,
          Math.max(DESKTOP_MIN_WIDTH, startWidth + delta),
        );
        updateDesktopWidth(newWidth);
      };

      const onPointerUp = () => {
        isDraggingRef.current = false;
        document.documentElement.style.transition = "";
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    },
    [desktopWidth, updateDesktopWidth],
  );

  const chatPanel = (
    <div className="relative flex flex-1 flex-col min-h-0">
      <button
        onClick={() => updateOpen(false)}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200 transition-colors"
        aria-label="Close panel"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <ChatTerminal />
    </div>
  );

  return (
    <>
      {!open && (
        <button
          onClick={() => updateOpen(true)}
          className="fixed z-50 bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground shadow-lg hover:opacity-90 transition-opacity text-sm font-medium"
          aria-label="Ask AI"
        >
          Ask AI
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-xs opacity-60 font-mono">
            <span>&#8984;</span>I
          </kbd>
        </button>
      )}

      <aside
        className={`hidden sm:flex fixed top-0 right-0 bottom-0 z-40 border-l border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 transition-transform duration-150 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{ width: desktopWidth }}
        aria-hidden={!open}
      >
        <div
          onPointerDown={handleResizePointerDown}
          className="absolute top-0 bottom-0 left-0 w-1.5 cursor-col-resize hover:bg-neutral-300/30 dark:hover:bg-neutral-600/30 active:bg-neutral-300/50 dark:active:bg-neutral-600/50 transition-colors z-10"
        />
        <div className="flex flex-col flex-1 min-w-0">
          {showTerminal && chatPanel}
        </div>
      </aside>

      {hasMounted && !isDesktop && (
        <Sheet open={open} onOpenChange={updateOpen}>
          <SheetContent
            side="right"
            showCloseButton={false}
            overlayClassName="bg-white! dark:bg-neutral-950!"
            className="inset-0! w-full! h-full! max-w-none! p-0! flex flex-col"
            style={{ backgroundColor: "inherit", opacity: 1 }}
          >
            <SheetTitle className="sr-only">AI Chat</SheetTitle>
            {open && chatPanel}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
