import type { Bash, NetworkConfig } from "just-bash";
import stringWidth from "string-width";

export type { NetworkConfig } from "just-bash";

export interface ShellOptions {
  files?: Record<string, string>;
  env?: Record<string, string>;
  cwd?: string;
  greeting?: string | string[];
  prompt?: (cwd: string) => string;
  network?: NetworkConfig;
}

function defaultPrompt(cwd: string): string {
  const display = cwd.replace(/^\/home\/user/, "~") || "/";
  return `\x1b[1;32muser@wterm\x1b[0m:\x1b[1;34m${display}\x1b[0m$ `;
}

const WORD_LEFT_SEQUENCES = new Set(["\x1b[1;3D", "\x1b[1;5D", "\x1bb"]);
const WORD_RIGHT_SEQUENCES = new Set(["\x1b[1;3C", "\x1b[1;5C", "\x1bf"]);
const WORD_ERASE_SEQUENCES = new Set(["\x1b\x7f", "\x1b\b", "\x17"]);
const HOME_SEQUENCES = new Set(["\x1b[H", "\x1bOH"]);
const END_SEQUENCES = new Set(["\x1b[F", "\x1bOF"]);
const PRINTABLE_TEXT = /^[^\p{Cc}]+$/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function previousGraphemeStart(line: string, cursor: number): number {
  return graphemes.segment(line).containing(cursor - 1)?.index ?? 0;
}

function nextGraphemeEnd(line: string, cursor: number): number {
  const next = graphemes.segment(line).containing(cursor);
  return next ? next.index + next.segment.length : line.length;
}

export class BashShell {
  private _bash: Bash | null = null;
  private _write: ((data: string) => void) | null = null;
  private _cwd: string;
  private _line = "";
  // UTF-16 offset in _line; terminal cursor motion uses cell widths.
  private _cursor = 0;
  private _buffer = "";
  private _history: string[] = [];
  private _historyPos = -1;
  private _historyDraft: { line: string; cursor: number } | null = null;
  private _busy = false;

  private _files: Record<string, string>;
  private _env: Record<string, string>;
  private _greeting: string[];
  private _prompt: (cwd: string) => string;
  private _network?: NetworkConfig;

  constructor(options: ShellOptions = {}) {
    this._files = options.files ?? {};
    this._env = options.env ?? { SHELL: "/bin/bash", TERM: "xterm-256color" };
    this._cwd = options.cwd ?? "/home/user";
    this._prompt = options.prompt ?? defaultPrompt;
    this._network = options.network;

    if (options.greeting === undefined) {
      this._greeting = [];
    } else if (typeof options.greeting === "string") {
      this._greeting = [options.greeting];
    } else {
      this._greeting = options.greeting;
    }
  }

  get cwd(): string {
    return this._cwd;
  }

  get bash(): Bash | null {
    return this._bash;
  }

  async attach(write: (data: string) => void): Promise<void> {
    this._write = write;

    const { Bash } = await import("just-bash");
    this._bash = new Bash({
      files: this._files,
      env: this._env,
      network: this._network,
    });

    if (this._greeting.length > 0) {
      write(this._greeting.join("\r\n") + "\r\n");
    }
    write(this._prompt(this._cwd));
  }

  async handleInput(data: string): Promise<void> {
    if (!this._write || this._busy) return;
    const write = this._write;

    if (data === "\t") {
      await this._tabComplete();
      return;
    }

    if (data === "\r") {
      const cur = this._line;
      this._line = "";
      this._cursor = 0;
      write("\r\n");

      if (cur.endsWith("\\")) {
        this._buffer += cur + "\n";
        write("> ");
        return;
      }

      const cmd = this._buffer + cur;
      this._buffer = "";
      this._historyPos = -1;
      this._historyDraft = null;

      if (cmd.trim() && this._bash) {
        this._history.push(cmd);
        this._busy = true;

        try {
          const wrapped = `cd ${JSON.stringify(this._cwd)} && ${cmd}`;
          const result = await this._bash.exec(wrapped);
          if (result.stdout) {
            write(result.stdout.replace(/\n/g, "\r\n"));
            if (!result.stdout.endsWith("\n")) write("\r\n");
          }
          if (result.stderr) {
            write(`\x1b[31m${result.stderr.replace(/\n/g, "\r\n")}\x1b[0m`);
            if (!result.stderr.endsWith("\n")) write("\r\n");
          }
          const pwdResult = await this._bash.exec(
            `cd ${JSON.stringify(this._cwd)} 2>/dev/null; ${cmd} >/dev/null 2>&1; pwd`,
          );
          const lines = pwdResult.stdout?.trim().split("\n") ?? [];
          const lastLine = lines[lines.length - 1]?.trim();
          if (lastLine?.startsWith("/")) this._cwd = lastLine;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          write(`\x1b[31m${msg}\x1b[0m\r\n`);
        } finally {
          this._busy = false;
        }
      }

      write(this._prompt(this._cwd));
    } else if (data === "\x7f" || data === "\b") {
      if (this._cursor > 0) {
        this._eraseBeforeCursor(
          previousGraphemeStart(this._line, this._cursor),
        );
      }
    } else if (WORD_ERASE_SEQUENCES.has(data)) {
      this._eraseBeforeCursor(this._wordBoundary(-1));
    } else if (data === "\x1b[3~") {
      if (this._cursor < this._line.length) {
        const tail = this._line.slice(
          nextGraphemeEnd(this._line, this._cursor),
        );
        this._line = this._line.slice(0, this._cursor) + tail;
        write(tail + "\x1b[K");
        this._moveCells(stringWidth(tail), "D");
      }
    } else if (data === "\x1b[A") {
      if (!this._history.length) return;
      if (this._historyPos < 0) {
        this._historyDraft = { line: this._line, cursor: this._cursor };
        this._historyPos = this._history.length;
      }
      if (this._historyPos > 0) {
        this._historyPos--;
        this._showLine(this._history[this._historyPos]);
      }
    } else if (data === "\x1b[B") {
      if (this._historyPos < 0) return;
      this._historyPos++;
      if (this._historyPos >= this._history.length) {
        this._historyPos = -1;
        const draft = this._historyDraft;
        this._historyDraft = null;
        this._showLine(draft?.line ?? "", draft?.cursor ?? 0);
      } else {
        this._showLine(this._history[this._historyPos]);
      }
    } else if (data === "\x1b[D") {
      if (this._cursor > 0) {
        const start = previousGraphemeStart(this._line, this._cursor);
        const width = stringWidth(this._line.slice(start, this._cursor));
        this._cursor = start;
        this._moveCells(width, "D", true);
      }
    } else if (data === "\x1b[C") {
      if (this._cursor < this._line.length) {
        const end = nextGraphemeEnd(this._line, this._cursor);
        const width = stringWidth(this._line.slice(this._cursor, end));
        this._cursor = end;
        this._moveCells(width, "C", true);
      }
    } else if (WORD_LEFT_SEQUENCES.has(data)) {
      this._moveWord(-1);
    } else if (WORD_RIGHT_SEQUENCES.has(data)) {
      this._moveWord(1);
    } else if (data === "\x15") {
      this._eraseBeforeCursor(0);
    } else if (data === "\x0b") {
      if (this._cursor < this._line.length) {
        this._line = this._line.slice(0, this._cursor);
        write("\x1b[K");
      }
    } else if (data === "\x01" || HOME_SEQUENCES.has(data)) {
      if (this._cursor > 0) {
        this._moveCells(stringWidth(this._line.slice(0, this._cursor)), "D");
        this._cursor = 0;
      }
    } else if (data === "\x05" || END_SEQUENCES.has(data)) {
      if (this._cursor < this._line.length) {
        this._moveCells(stringWidth(this._line.slice(this._cursor)), "C");
        this._cursor = this._line.length;
      }
    } else if (data === "\x03") {
      this._line = "";
      this._cursor = 0;
      this._buffer = "";
      this._historyPos = -1;
      this._historyDraft = null;
      write("^C\r\n");
      write(this._prompt(this._cwd));
    } else if (data === "\x0c") {
      write("\x1b[2J\x1b[H");
      write(this._prompt(this._cwd));
      write(this._line);
      if (this._cursor < this._line.length) {
        this._moveCells(stringWidth(this._line.slice(this._cursor)), "D");
      }
    } else if (data.startsWith("\x1b[") || data.startsWith("\x1bO")) {
      // Ignore unsupported functional keys instead of inserting their escape suffix.
      return;
    } else if (PRINTABLE_TEXT.test(data)) {
      this._insertText(data);
    } else if (data.length > 1) {
      for (const ch of data) {
        await this.handleInput(ch);
      }
    }
  }

  private _moveCells(
    width: number,
    direction: "C" | "D",
    shortSingleStep = false,
  ): void {
    if (width > 0) {
      const count = shortSingleStep && width === 1 ? "" : width;
      this._write?.(`\x1b[${count}${direction}`);
    }
  }

  private _insertText(text: string): void {
    const write = this._write;
    if (!write) return;
    const tail = this._line.slice(this._cursor);
    this._line = this._line.slice(0, this._cursor) + text + tail;
    this._cursor += text.length;
    if (tail.length === 0) {
      write(text);
    } else {
      write(text + tail + "\x1b[K");
      this._moveCells(stringWidth(tail), "D");
    }
  }

  private _eraseBeforeCursor(start: number): void {
    if (start === this._cursor) return;
    const write = this._write;
    if (!write) return;
    const removedWidth = stringWidth(this._line.slice(start, this._cursor));
    const tail = this._line.slice(this._cursor);
    this._line = this._line.slice(0, start) + tail;
    this._cursor = start;
    const moveLeft =
      removedWidth === 1
        ? "\b"
        : removedWidth > 0
          ? `\x1b[${removedWidth}D`
          : "";
    write(moveLeft + tail + "\x1b[K");
    this._moveCells(stringWidth(tail), "D");
  }

  private _showLine(line: string, cursor = line.length): void {
    this._line = line;
    this._cursor = cursor;
    this._write?.(`\r${this._prompt(this._cwd)}\x1b[K${line}`);
    this._moveCells(stringWidth(line.slice(cursor)), "D");
  }

  private _moveWord(direction: -1 | 1): void {
    const start = this._cursor;
    this._cursor = this._wordBoundary(direction);
    const width = stringWidth(
      this._line.slice(
        Math.min(start, this._cursor),
        Math.max(start, this._cursor),
      ),
    );
    this._moveCells(width, direction === -1 ? "D" : "C");
  }

  private _wordBoundary(direction: -1 | 1): number {
    const segments = [...graphemes.segment(this._line)];
    let index = segments.findIndex((segment) => segment.index >= this._cursor);
    if (index < 0) index = segments.length;
    const isWhitespace = (segment: string) => /^\s+$/u.test(segment);

    if (direction === -1) {
      while (index > 0 && isWhitespace(segments[index - 1].segment)) index--;
      while (index > 0 && !isWhitespace(segments[index - 1].segment)) index--;
    } else {
      while (index < segments.length && isWhitespace(segments[index].segment))
        index++;
      while (index < segments.length && !isWhitespace(segments[index].segment))
        index++;
    }

    return segments[index]?.index ?? this._line.length;
  }

  private async _tabComplete(): Promise<void> {
    const bash = this._bash;
    const write = this._write;
    if (!bash || !write) return;

    const line = this._line;
    const parts = line.split(/\s+/);
    const word = parts[parts.length - 1] ?? "";
    const isFirst = parts.length <= 1;

    let dir: string;
    let prefix: string;
    if (word.includes("/")) {
      const lastSlash = word.lastIndexOf("/");
      const rawDir = word.slice(0, lastSlash + 1);
      prefix = word.slice(lastSlash + 1);
      if (rawDir.startsWith("/")) {
        dir = rawDir;
      } else if (rawDir.startsWith("~/")) {
        dir = `/home/user/${rawDir.slice(2)}`;
      } else {
        dir = `${this._cwd}/${rawDir}`;
      }
    } else {
      dir = this._cwd;
      prefix = word;
    }

    let candidates: string[] = [];
    try {
      const result = await bash.exec(`ls -1a ${JSON.stringify(dir)}`, {
        cwd: this._cwd,
      });
      if (result.exitCode === 0 && result.stdout) {
        candidates = result.stdout
          .split("\n")
          .filter((f) => f && f !== "." && f !== ".." && f.startsWith(prefix));
      }
    } catch {
      return;
    }

    if (isFirst && !word.includes("/")) {
      try {
        const cmdResult = await bash.exec(
          `compgen -c ${JSON.stringify(prefix)} 2>/dev/null || true`,
          { cwd: this._cwd },
        );
        if (cmdResult.exitCode === 0 && cmdResult.stdout) {
          const cmds = cmdResult.stdout.split("\n").filter(Boolean);
          for (const c of cmds) {
            if (!candidates.includes(c)) candidates.push(c);
          }
        }
      } catch {
        /* compgen may not be available */
      }
    }

    if (candidates.length === 0) return;

    if (candidates.length === 1) {
      const completion = candidates[0].slice(prefix.length);
      if (completion) {
        this._line += completion;
        this._cursor += completion.length;
        write(completion);
      }
      try {
        const full = word + completion;
        const testPath = full.startsWith("/") ? full : `${this._cwd}/${full}`;
        const stat = await bash.exec(
          `test -d ${JSON.stringify(testPath)} && echo DIR`,
          { cwd: this._cwd },
        );
        if (stat.stdout?.trim() === "DIR" && !this._line.endsWith("/")) {
          this._line += "/";
          this._cursor++;
          write("/");
        }
      } catch {
        /* ignore */
      }
    } else {
      let common = candidates[0];
      for (let i = 1; i < candidates.length; i++) {
        while (!candidates[i].startsWith(common)) {
          common = common.slice(0, -1);
        }
      }
      const partialCompletion = common.slice(prefix.length);
      if (partialCompletion) {
        this._line += partialCompletion;
        this._cursor += partialCompletion.length;
        write(partialCompletion);
      } else {
        write("\r\n");
        write(candidates.join("  ").replace(/\n/g, "\r\n"));
        write("\r\n");
        write(this._prompt(this._cwd));
        write(this._line);
      }
    }
  }
}
