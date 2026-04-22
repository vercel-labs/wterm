import { describe, it, expect, beforeEach } from "vitest";
import { Renderer } from "../renderer.js";
import type { CellData, CursorState } from "@wterm/core";

function createMockBridge(cols: number, rows: number, grid: CellData[][] = []) {
  const dirtyRows = new Set<number>();
  for (let r = 0; r < rows; r++) dirtyRows.add(r);

  return {
    getCols: () => cols,
    getRows: () => rows,
    getCell: (row: number, col: number): CellData =>
      grid[row]?.[col] ?? { char: 0, fg: 256, bg: 256, flags: 0 },
    isDirtyRow: (row: number) => dirtyRows.has(row),
    clearDirty: () => dirtyRows.clear(),
    getCursor: (): CursorState => ({ row: 0, col: 0, visible: true }),
    getScrollbackCount: () => 0,
    getScrollbackCell: (_offset: number, _col: number): CellData => ({
      char: 0,
      fg: 256,
      bg: 256,
      flags: 0,
    }),
    getScrollbackLineLen: () => 0,
  };
}

function makeCell(char: string, fg = 256, bg = 256, flags = 0): CellData {
  return { char: char.codePointAt(0)!, fg, bg, flags };
}

describe("Renderer", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  describe("setup", () => {
    it("creates row elements for each row", () => {
      const renderer = new Renderer(container);
      renderer.setup(80, 24);
      const rows = container.querySelectorAll(".term-row");
      expect(rows).toHaveLength(24);
    });

    it("clears previous content on re-setup", () => {
      const renderer = new Renderer(container);
      renderer.setup(80, 24);
      renderer.setup(40, 12);
      const rows = container.querySelectorAll(".term-row");
      expect(rows).toHaveLength(12);
    });
  });

  describe("render", () => {
    it("renders text content from bridge cells", () => {
      const grid = [[makeCell("H"), makeCell("i")]];
      const bridge = createMockBridge(2, 1, grid);
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      const text = container.textContent;
      expect(text).toContain("H");
      expect(text).toContain("i");
    });

    it("applies cursor class to cursor position", () => {
      const grid = [[makeCell("A"), makeCell("B")]];
      const bridge = createMockBridge(2, 1, grid);
      bridge.getCursor = () => ({ row: 0, col: 0, visible: true });
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      const cursor = container.querySelector(".term-cursor");
      expect(cursor).not.toBeNull();
      expect(cursor?.textContent).toBe("A");
    });

    it("re-renders on resize", () => {
      const bridge1 = createMockBridge(2, 1, [[makeCell("X")]]);
      const renderer = new Renderer(container);
      renderer.render(bridge1 as any);
      expect(container.querySelectorAll(".term-row")).toHaveLength(1);

      const bridge2 = createMockBridge(4, 3, []);
      renderer.render(bridge2 as any);
      expect(container.querySelectorAll(".term-row")).toHaveLength(3);
    });

    it("skips clean rows", () => {
      const grid = [[makeCell("A")]];
      const bridge = createMockBridge(1, 2, grid);
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      const rows = container.querySelectorAll(".term-row");
      const row1Text = rows[0].textContent;
      expect(row1Text).toContain("A");
    });

    it("applies styled spans for colored cells", () => {
      const grid = [[makeCell("C", 1, 256, 0)]];
      const bridge = createMockBridge(1, 1, grid);
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      const span = container.querySelector("span[style]");
      expect(span).not.toBeNull();
      expect(span?.getAttribute("style")).toContain("color:");
    });

    it("applies bold style via flags", () => {
      const FLAG_BOLD = 0x01;
      const grid = [[makeCell("B", 256, 256, FLAG_BOLD)]];
      const bridge = createMockBridge(1, 1, grid);
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      const span = container.querySelector("span[style]");
      expect(span?.getAttribute("style")).toMatch(/font-weight:\s*bold/);
    });
  });

  describe("linkify", () => {
    function makeLinkifyBridge(rowText: string, cols?: number) {
      const width = cols ?? rowText.length;
      const grid: CellData[][] = [
        Array.from({ length: width }, (_, i) =>
          i < rowText.length ? makeCell(rowText[i]) : { char: 0, fg: 256, bg: 256, flags: 0 },
        ),
      ];
      const bridge = createMockBridge(width, 1, grid);
      bridge.getCursor = () => ({ row: 0, col: -1, visible: false });
      return bridge;
    }

    it("renders a URL as an anchor when linkify is enabled", () => {
      const bridge = makeLinkifyBridge("go https://example.com/ now");
      const renderer = new Renderer(container, {
        linkify: {
          enabled: true,
          pattern: /\bhttps?:\/\/[^\s<>"'`]+/g,
          onClick: null,
        },
      });
      renderer.render(bridge as any);

      const anchor = container.querySelector("a.term-link");
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute("href")).toBe("https://example.com/");
      expect(anchor?.getAttribute("target")).toBe("_blank");
      expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(anchor?.textContent).toBe("https://example.com/");
    });

    it("renders multiple URLs on one row as separate anchors", () => {
      const bridge = makeLinkifyBridge("see http://a.com and https://b.com/x");
      const renderer = new Renderer(container, {
        linkify: { enabled: true, pattern: /\bhttps?:\/\/[^\s<>"'`]+/g, onClick: null },
      });
      renderer.render(bridge as any);
      const anchors = container.querySelectorAll("a.term-link");
      expect(anchors).toHaveLength(2);
      expect(anchors[0].getAttribute("href")).toBe("http://a.com");
      expect(anchors[1].getAttribute("href")).toBe("https://b.com/x");
    });

    it("wraps a styled URL span in a single anchor", () => {
      const FLAG_BOLD = 0x01;
      const text = "https://example.com";
      const cells = Array.from(text).map((ch, i) =>
        // Make the last 7 chars (".com") bold to force a style split inside
        // the URL. Cols 12..18 bold.
        i >= 12 ? makeCell(ch, 256, 256, FLAG_BOLD) : makeCell(ch),
      );
      const bridge = createMockBridge(text.length, 1, [cells]);
      bridge.getCursor = () => ({ row: 0, col: -1, visible: false });
      const renderer = new Renderer(container, {
        linkify: { enabled: true, pattern: /\bhttps?:\/\/[^\s<>"'`]+/g, onClick: null },
      });
      renderer.render(bridge as any);
      const anchors = container.querySelectorAll("a.term-link");
      expect(anchors).toHaveLength(1);
      expect(anchors[0].getAttribute("href")).toBe(text);
      // Both styled and unstyled spans must live inside the anchor.
      expect(anchors[0].querySelectorAll("span").length).toBeGreaterThanOrEqual(2);
      expect(anchors[0].textContent).toBe(text);
    });

    it("strips trailing punctuation from href", () => {
      const bridge = makeLinkifyBridge("see https://example.com.");
      const renderer = new Renderer(container, {
        linkify: { enabled: true, pattern: /\bhttps?:\/\/[^\s<>"'`]+/g, onClick: null },
      });
      renderer.render(bridge as any);
      const anchor = container.querySelector("a.term-link");
      expect(anchor?.getAttribute("href")).toBe("https://example.com");
      // The trailing '.' must still be rendered (outside the anchor) as plain text.
      expect(container.textContent).toContain("https://example.com.");
    });

    it("emits no anchors when linkify is disabled (default)", () => {
      const bridge = makeLinkifyBridge("see https://example.com");
      const renderer = new Renderer(container); // no linkify passed
      renderer.render(bridge as any);
      expect(container.querySelector("a.term-link")).toBeNull();
    });

    it("accepts a custom /g regex pattern", () => {
      const bridge = makeLinkifyBridge("see JIRA-42 please");
      const renderer = new Renderer(container, {
        linkify: { enabled: true, pattern: /\bJIRA-\d+\b/g, onClick: null },
      });
      renderer.render(bridge as any);
      const anchor = container.querySelector("a.term-link");
      // Default href is the raw match — users can provide onClick to override nav.
      expect(anchor?.getAttribute("href")).toBe("JIRA-42");
    });

    it("renders the cursor inside a URL anchor correctly", () => {
      const text = "https://example.com";
      const cells = Array.from(text).map((ch) => makeCell(ch));
      const bridge = createMockBridge(text.length, 1, [cells]);
      // Cursor on 'x' at col 9
      bridge.getCursor = () => ({ row: 0, col: 9, visible: true });
      const renderer = new Renderer(container, {
        linkify: { enabled: true, pattern: /\bhttps?:\/\/[^\s<>"'`]+/g, onClick: null },
      });
      renderer.render(bridge as any);
      const anchor = container.querySelector("a.term-link");
      const cursor = anchor?.querySelector(".term-cursor");
      expect(cursor).not.toBeNull();
      expect(cursor?.textContent).toBe("x");
    });

    it("renders URLs inside scrollback rows as anchors", () => {
      const text = "see https://scroll.example";
      const sbLen = text.length;
      const bridge = createMockBridge(sbLen, 1, []);
      bridge.getScrollbackCount = () => 1;
      bridge.getScrollbackLineLen = () => sbLen;
      bridge.getScrollbackCell = (_o: number, col: number): CellData =>
        col < text.length
          ? makeCell(text[col])
          : { char: 0, fg: 256, bg: 256, flags: 0 };

      const renderer = new Renderer(container, {
        linkify: { enabled: true, pattern: /\bhttps?:\/\/[^\s<>"'`]+/g, onClick: null },
      });
      renderer.render(bridge as any);

      const scrollbackRow = container.querySelector(".term-scrollback-row");
      expect(scrollbackRow).not.toBeNull();
      const anchor = scrollbackRow!.querySelector("a.term-link");
      expect(anchor?.getAttribute("href")).toBe("https://scroll.example");
    });

    it("keeps URL ranges aligned when a block glyph precedes the URL", () => {
      // Regression test for the pre-pass: block glyphs must emit a space
      // placeholder into rowText so findUrls ranges line up with grid cols.
      const text = "https://a.com";
      const blockCp = 0x2588; // FULL BLOCK
      const cells = [
        { char: blockCp, fg: 256, bg: 256, flags: 0 },
        makeCell(" "),
        ...Array.from(text).map((ch) => makeCell(ch)),
      ];
      const bridge = createMockBridge(cells.length, 1, [cells]);
      bridge.getCursor = () => ({ row: 0, col: -1, visible: false });
      const renderer = new Renderer(container, {
        linkify: { enabled: true, pattern: /\bhttps?:\/\/[^\s<>"'`]+/g, onClick: null },
      });
      renderer.render(bridge as any);
      const anchor = container.querySelector("a.term-link");
      expect(anchor?.getAttribute("href")).toBe(text);
      expect(anchor?.textContent).toBe(text);
    });

    it("invokes onClick before default navigation and respects preventDefault", () => {
      const bridge = makeLinkifyBridge("go https://example.com/");
      const seen: string[] = [];
      const renderer = new Renderer(container, {
        linkify: {
          enabled: true,
          pattern: /\bhttps?:\/\/[^\s<>"'`]+/g,
          onClick: (url, ev) => {
            seen.push(url);
            ev.preventDefault();
          },
        },
      });
      renderer.render(bridge as any);
      const anchor = container.querySelector<HTMLAnchorElement>("a.term-link")!;
      const clickEv = new MouseEvent("click", { bubbles: true, cancelable: true });
      anchor.dispatchEvent(clickEv);
      expect(seen).toEqual(["https://example.com/"]);
      expect(clickEv.defaultPrevented).toBe(true);
    });
  });
});
