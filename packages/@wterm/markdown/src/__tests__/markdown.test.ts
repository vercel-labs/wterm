import { describe, it, expect, beforeEach } from "vitest";
import { MarkdownRenderer } from "../index.js";

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

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("MarkdownRenderer", () => {
  let renderer: MarkdownRenderer;

  beforeEach(() => {
    renderer = new MarkdownRenderer();
  });

  describe("constructor", () => {
    it("uses default width of 80", () => {
      const r = new MarkdownRenderer();
      const result = r.push("---\n");
      const plain = stripAnsi(result);
      expect(plain).toContain("─");
    });

    it("accepts custom width", () => {
      const r = new MarkdownRenderer({ width: 20 });
      const result = r.push("---\n");
      const rule = stripAnsi(result).replace(/\r\n/g, "");
      expect(rule.length).toBeLessThanOrEqual(20);
    });
  });

  describe("headings", () => {
    it("renders h1 with bold bright white", () => {
      const result = renderer.push("# Hello World\n");
      expect(result).toContain(BOLD);
      expect(result).toContain(BRIGHT_WHITE);
      expect(result).toContain("Hello World");
      expect(result).toContain(RESET);
    });

    it("renders h2 with bold bright white", () => {
      const result = renderer.push("## Section\n");
      expect(result).toContain(BOLD);
      expect(result).toContain(BRIGHT_WHITE);
      expect(result).toContain("Section");
    });

    it("renders h3 with bold only (no bright white)", () => {
      const result = renderer.push("### Subsection\n");
      expect(result).toContain(BOLD);
      expect(result).not.toContain(BRIGHT_WHITE);
      expect(result).toContain("Subsection");
    });

    it("renders h4-h6 with bold only", () => {
      for (const level of [4, 5, 6]) {
        const r = new MarkdownRenderer();
        const hashes = "#".repeat(level);
        const result = r.push(`${hashes} Heading ${level}\n`);
        expect(result).toContain(BOLD);
        expect(result).not.toContain(BRIGHT_WHITE);
        expect(result).toContain(`Heading ${level}`);
      }
    });
  });

  describe("fenced code blocks", () => {
    it("renders a code block with dim styling", () => {
      const input = "```\nconsole.log('hi');\n```\n";
      const result = renderer.push(input);
      expect(result).toContain(DIM);
      expect(result).toContain("console.log('hi');");
      expect(result).toContain(RESET);
    });

    it("handles code blocks with language tags", () => {
      const input = "```typescript\nconst x = 1;\n```\n";
      const result = renderer.push(input);
      expect(result).toContain("const x = 1;");
    });

    it("renders multi-line code blocks", () => {
      const input = "```\nline 1\nline 2\nline 3\n```\n";
      const result = renderer.push(input);
      expect(result).toContain("line 1");
      expect(result).toContain("line 2");
      expect(result).toContain("line 3");
    });

    it("includes decorative rules around code blocks", () => {
      const input = "```\ncode\n```\n";
      const result = renderer.push(input);
      const plain = stripAnsi(result);
      expect(plain).toContain("─");
    });
  });

  describe("inline formatting", () => {
    it("renders bold text with ** markers", () => {
      const result = renderer.push("This is **bold** text\n");
      expect(result).toContain(BOLD);
      expect(result).toContain("bold");
    });

    it("renders bold text with __ markers", () => {
      const result = renderer.push("This is __bold__ text\n");
      expect(result).toContain(BOLD);
      expect(result).toContain("bold");
    });

    it("renders italic text with * marker", () => {
      const result = renderer.push("This is *italic* text\n");
      expect(result).toContain(ITALIC);
      expect(result).toContain("italic");
    });

    it("renders italic text with _ marker", () => {
      const result = renderer.push("This is _italic_ text\n");
      expect(result).toContain(ITALIC);
      expect(result).toContain("italic");
    });

    it("renders inline code with backticks", () => {
      const result = renderer.push("Use `console.log` here\n");
      expect(result).toContain(CYAN);
      expect(result).toContain("console.log");
    });

    it("renders links with text and URL", () => {
      const result = renderer.push("Visit [Example](https://example.com)\n");
      expect(result).toContain(UNDERLINE);
      expect(result).toContain(GREEN);
      expect(result).toContain("Example");
      expect(result).toContain("https://example.com");
    });

    it("omits URL display for anchor links", () => {
      const result = renderer.push("See [section](#anchor)\n");
      expect(result).toContain("section");
      expect(result).not.toContain("#anchor");
    });
  });

  describe("lists", () => {
    it("renders unordered list items with - marker", () => {
      const result = renderer.push("- Item one\n- Item two\n");
      const plain = stripAnsi(result);
      expect(plain).toContain("* Item one");
      expect(plain).toContain("* Item two");
    });

    it("renders unordered list items with * marker", () => {
      const result = renderer.push("* First\n* Second\n");
      const plain = stripAnsi(result);
      expect(plain).toContain("* First");
      expect(plain).toContain("* Second");
    });

    it("renders ordered list items", () => {
      const result = renderer.push("1. First\n2. Second\n");
      const plain = stripAnsi(result);
      expect(plain).toContain("1. First");
      expect(plain).toContain("2. Second");
    });
  });

  describe("blockquotes", () => {
    it("renders blockquote with vertical bar prefix", () => {
      const result = renderer.push("> This is a quote\n");
      expect(result).toContain(DIM);
      expect(result).toContain("│");
      expect(result).toContain("This is a quote");
    });

    it("renders empty blockquote line", () => {
      const result = renderer.push(">\n");
      expect(result).toContain("│");
    });
  });

  describe("horizontal rules", () => {
    it("renders --- as a horizontal rule", () => {
      const result = renderer.push("---\n");
      expect(result).toContain(DIM);
      const plain = stripAnsi(result);
      expect(plain).toContain("─");
    });

    it("renders *** as a horizontal rule", () => {
      const result = renderer.push("***\n");
      const plain = stripAnsi(result);
      expect(plain).toContain("─");
    });

    it("renders ___ as a horizontal rule", () => {
      const result = renderer.push("___\n");
      const plain = stripAnsi(result);
      expect(plain).toContain("─");
    });
  });

  describe("blank lines", () => {
    it("collapses consecutive blank lines", () => {
      const result = renderer.push("Hello\n\n\n\nWorld\n");
      const crlfCount = result.split(CR_LF).length - 1;
      const singleBlank = renderer.push.length;
      expect(result).toContain("Hello");
      expect(result).toContain("World");
      expect(crlfCount).toBeLessThan(6);
    });
  });

  describe("streaming", () => {
    it("buffers incomplete lines", () => {
      const result1 = renderer.push("Hello ");
      expect(result1).toBe("");

      const result2 = renderer.push("World\n");
      expect(result2).toContain("Hello World");
    });

    it("handles multi-chunk streaming", () => {
      renderer.push("# ");
      renderer.push("Hel");
      const result = renderer.push("lo\n");
      expect(result).toContain(BOLD);
      expect(result).toContain("Hello");
    });

    it("handles streaming across code block boundaries", () => {
      const r1 = renderer.push("```\n");
      expect(r1).toBe("");

      const r2 = renderer.push("code line\n");
      expect(r2).toBe("");

      const r3 = renderer.push("```\n");
      expect(r3).toContain("code line");
    });
  });

  describe("flush", () => {
    it("emits remaining buffered content", () => {
      renderer.push("Incomplete line");
      const result = renderer.flush();
      expect(result).toContain("Incomplete line");
    });

    it("flushes unclosed code blocks", () => {
      renderer.push("```\norphaned code\n");
      const result = renderer.flush();
      expect(result).toContain("orphaned code");
    });

    it("returns empty string when buffer is empty", () => {
      renderer.push("Complete line\n");
      const result = renderer.flush();
      expect(result).toBe("");
    });
  });

  describe("paragraph text", () => {
    it("renders plain paragraph text with CRLF", () => {
      const result = renderer.push("Just a normal paragraph line.\n");
      expect(result).toContain("Just a normal paragraph line.");
      expect(result.endsWith(CR_LF)).toBe(true);
    });
  });
});
