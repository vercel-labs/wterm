"use client";

import { useCallback, useRef } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import { MarkdownRenderer } from "@wterm/markdown";
import "@wterm/react/css";

type ChatMessage = { role: "user" | "assistant"; content: string };

class ChatShell {
  private _write: ((data: string) => void) | null = null;
  private _messages: ChatMessage[] = [];
  private _line = "";
  private _busy = false;
  private _abortController: AbortController | null = null;

  attach(write: (data: string) => void) {
    this._write = write;
    write("\x1b[1;36mMarkdown Streaming Demo\x1b[0m\r\n");
    write(
      "\x1b[2mType a message and press Enter to chat with an LLM.\x1b[0m\r\n",
    );
    write(
      "\x1b[2mResponses are streamed through @wterm/markdown.\x1b[0m\r\n\r\n",
    );
    this._showPrompt();
  }

  async handleInput(data: string) {
    if (!this._write) return;
    const w = this._write;

    if (this._busy) {
      if (data === "\x03") this._abortController?.abort();
      return;
    }

    if (data === "\r") {
      const query = this._line.trim();
      this._line = "";
      w("\r\n");

      if (!query) {
        this._showPrompt();
        return;
      }

      this._busy = true;
      let fullText = "";
      const md = new MarkdownRenderer();

      try {
        this._messages.push({ role: "user", content: query });
        this._abortController = new AbortController();

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: this._messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: this._abortController.signal,
        });

        if (!response.ok) {
          const err = await response
            .json()
            .catch(() => ({ error: "Request failed" }));
          w(`\x1b[31m${err.error || "Error"}\x1b[0m\r\n`);
          this._messages.pop();
          this._busy = false;
          this._abortController = null;
          this._showPrompt();
          return;
        }

        w("\r\n");
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          const rendered = md.push(chunk);
          if (rendered) w(rendered);
        }

        const remaining = md.flush();
        if (remaining) w(remaining);

        this._messages.push({ role: "assistant", content: fullText });
        w("\r\n");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          if (fullText) {
            this._messages.push({ role: "assistant", content: fullText });
          } else {
            this._messages.pop();
          }
          w("\r\n");
        } else {
          const msg = err instanceof Error ? err.message : "Unknown error";
          w(`\x1b[31m${msg}\x1b[0m\r\n`);
          this._messages.pop();
        }
      } finally {
        this._busy = false;
        this._abortController = null;
        this._showPrompt();
      }
    } else if (data === "\x7f" || data === "\b") {
      if (this._line.length > 0) {
        this._line = this._line.slice(0, -1);
        w("\b \b");
      }
    } else if (data === "\x03") {
      this._line = "";
      w("^C\r\n");
      this._showPrompt();
    } else if (data.length === 1 && data >= " ") {
      this._line += data;
      w(data);
    }
  }

  private _showPrompt() {
    this._write!("\x1b[1;32m>\x1b[0m ");
  }
}

export default function Page() {
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
    <div style={{ height: "100vh" }}>
      <Terminal
        ref={ref}
        autoResize
        onReady={handleReady}
        onData={handleData}
      />
    </div>
  );
}
