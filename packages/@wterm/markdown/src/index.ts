const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const BRIGHT_WHITE = `${ESC}97m`;
const CR_LF = "\r\n";

export interface MarkdownRendererOptions {
  width?: number;
}

const enum BlockKind {
  None,
  CodeBlock,
}

export class MarkdownRenderer {
  private _width: number;
  private _buffer = "";
  private _block: BlockKind = BlockKind.None;
  private _codeLines: string[] = [];
  private _lastLineBlank = false;

  constructor(options: MarkdownRendererOptions = {}) {
    this._width = options.width ?? 80;
  }

  push(delta: string): string {
    this._buffer += delta;

    const lines = this._buffer.split("\n");
    // Keep the last (potentially incomplete) segment in the buffer
    this._buffer = lines.pop()!;

    let out = "";
    for (const line of lines) {
      out += this._processLine(line);
    }
    return out;
  }

  flush(): string {
    let out = "";
    if (this._block === BlockKind.CodeBlock) {
      out += this._flushCodeBlock();
    }
    if (this._buffer) {
      out += this._renderInline(this._buffer) + CR_LF;
      this._buffer = "";
    }
    return out;
  }

  private _processLine(raw: string): string {
    if (this._block === BlockKind.CodeBlock) {
      if (raw.trimEnd().startsWith("```")) {
        return this._flushCodeBlock();
      }
      this._codeLines.push(raw);
      return "";
    }

    if (raw.trimStart().startsWith("```")) {
      this._block = BlockKind.CodeBlock;
      this._codeLines = [];
      return "";
    }

    const trimmed = raw.trim();

    if (!trimmed) {
      if (this._lastLineBlank) return "";
      this._lastLineBlank = true;
      return CR_LF;
    }
    this._lastLineBlank = false;

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      return this._renderHeading(level, text);
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      const rule = "─".repeat(Math.min(this._width, 40));
      return `${DIM}${rule}${RESET}${CR_LF}`;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      const content = trimmed.slice(2);
      return `${DIM}│${RESET} ${this._renderInline(content)}${CR_LF}`;
    }
    if (trimmed === ">") {
      return `${DIM}│${RESET}${CR_LF}`;
    }

    // Unordered list
    const ulMatch = trimmed.match(/^([-*+])\s+(.+)$/);
    if (ulMatch) {
      return `  ${DIM}*${RESET} ${this._renderInline(ulMatch[2])}${CR_LF}`;
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      return `  ${DIM}${olMatch[1]}.${RESET} ${this._renderInline(olMatch[2])}${CR_LF}`;
    }

    // Regular paragraph line — word-wrap if needed
    return this._wrapLine(this._renderInline(trimmed));
  }

  private _renderHeading(level: number, text: string): string {
    const rendered = this._renderInline(text);
    if (level <= 2) {
      return `${CR_LF}${BOLD}${BRIGHT_WHITE}${rendered}${RESET}${CR_LF}${CR_LF}`;
    }
    return `${CR_LF}${BOLD}${rendered}${RESET}${CR_LF}${CR_LF}`;
  }

  private _flushCodeBlock(): string {
    this._block = BlockKind.None;
    let out = "";
    const rule = "─".repeat(Math.min(this._width - 4, 36));
    out += `${CR_LF}${DIM}  ${rule}${RESET}${CR_LF}`;
    for (const codeLine of this._codeLines) {
      out += `${DIM}  ${codeLine}${RESET}${CR_LF}`;
    }
    out += `${DIM}  ${rule}${RESET}${CR_LF}${CR_LF}`;
    this._codeLines = [];
    return out;
  }

  private _renderInline(text: string): string {
    let out = "";
    let i = 0;

    while (i < text.length) {
      // Bold: **text** or __text__
      if (
        (text[i] === "*" && text[i + 1] === "*") ||
        (text[i] === "_" && text[i + 1] === "_")
      ) {
        const marker = text.slice(i, i + 2);
        const endIdx = text.indexOf(marker, i + 2);
        if (endIdx !== -1) {
          out += `${BOLD}${this._renderInline(text.slice(i + 2, endIdx))}${RESET}`;
          i = endIdx + 2;
          continue;
        }
      }

      // Italic: *text* or _text_ (single)
      if (
        (text[i] === "*" || text[i] === "_") &&
        text[i + 1] !== text[i] &&
        text[i + 1] !== " "
      ) {
        const marker = text[i];
        const endIdx = text.indexOf(marker, i + 1);
        if (endIdx !== -1 && text[endIdx - 1] !== " ") {
          out += `${ITALIC}${this._renderInline(text.slice(i + 1, endIdx))}${RESET}`;
          i = endIdx + 1;
          continue;
        }
      }

      // Inline code: `code`
      if (text[i] === "`") {
        const endIdx = text.indexOf("`", i + 1);
        if (endIdx !== -1) {
          const code = text.slice(i + 1, endIdx);
          out += `${CYAN}${code}${RESET}`;
          i = endIdx + 1;
          continue;
        }
      }

      // Link: [text](url)
      if (text[i] === "[") {
        const closeBracket = text.indexOf("]", i + 1);
        if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
          const closeParen = text.indexOf(")", closeBracket + 2);
          if (closeParen !== -1) {
            const linkText = text.slice(i + 1, closeBracket);
            const url = text.slice(closeBracket + 2, closeParen);
            out += `${UNDERLINE}${GREEN}${linkText}${RESET}`;
            if (url && !url.startsWith("#")) {
              out += ` ${DIM}(${url})${RESET}`;
            }
            i = closeParen + 1;
            continue;
          }
        }
      }

      out += text[i];
      i++;
    }

    return out;
  }

  private _wrapLine(rendered: string): string {
    // For simplicity, just emit the line as-is with CR_LF.
    // True ANSI-aware word wrapping is complex because escape
    // sequences have zero visual width. The terminal itself will
    // wrap at its column boundary, which is acceptable.
    return rendered + CR_LF;
  }
}
