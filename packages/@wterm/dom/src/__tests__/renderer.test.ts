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

function makeCell(
  char: string,
  fg = 256,
  bg = 256,
  flags = 0,
  width = 1,
): CellData {
  return { char: char.codePointAt(0)!, fg, bg, flags, width };
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
    it("renders contiguous OSC 8 cells as one safe anchor", () => {
      const grid = [
        [
          {
            ...makeCell("L"),
            linkUri: "https://example.com/docs",
            linkKey: "docs",
          },
          {
            ...makeCell("I", 1),
            linkUri: "https://example.com/docs",
            linkKey: "docs",
          },
          {
            ...makeCell("N"),
            linkUri: "https://example.com/docs",
            linkKey: "docs",
          },
          {
            ...makeCell("K"),
            linkUri: "https://example.com/docs",
            linkKey: "docs",
          },
        ],
      ];
      const bridge = createMockBridge(4, 1, grid);
      bridge.getCursor = () => ({ row: 0, col: 4, visible: false });
      new Renderer(container).render(bridge as any);

      const links = container.querySelectorAll("a.term-link");
      expect(links).toHaveLength(1);
      expect(links[0].textContent).toBe("LINK");
      expect(links[0].getAttribute("href")).toBe("https://example.com/docs");
      expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("does not create anchors for unsafe or relative OSC 8 URIs", () => {
      const grid = [
        [
          { ...makeCell("X"), linkUri: "javascript:alert(1)", linkKey: "x" },
          { ...makeCell("Y"), linkUri: "/relative", linkKey: "y" },
        ],
      ];
      const bridge = createMockBridge(2, 1, grid);
      bridge.getCursor = () => ({ row: 0, col: 2, visible: false });
      new Renderer(container).render(bridge as any);

      expect(container.querySelectorAll("a")).toHaveLength(0);
      expect(container.querySelector(".term-row")?.textContent).toBe("XY");
    });

    it("escapes safe link hrefs before assigning row HTML", () => {
      const grid = [
        [
          {
            ...makeCell("L"),
            linkUri: "https://example.com/?a=1&b=2",
            linkKey: "escaped",
          },
        ],
      ];
      const bridge = createMockBridge(1, 1, grid);
      bridge.getCursor = () => ({ row: 0, col: 1, visible: false });

      let proto = Object.getPrototypeOf(container);
      while (proto && !Object.getOwnPropertyDescriptor(proto, "innerHTML")) {
        proto = Object.getPrototypeOf(proto);
      }
      const descriptor = Object.getOwnPropertyDescriptor(proto, "innerHTML")!;
      const assignedValues: string[] = [];
      Object.defineProperty(proto, "innerHTML", {
        ...descriptor,
        set(value: string) {
          assignedValues.push(value);
          descriptor.set!.call(this, value);
        },
      });

      try {
        new Renderer(container).render(bridge as any);
      } finally {
        Object.defineProperty(proto, "innerHTML", descriptor);
      }

      const rowHtml = assignedValues.find((value) =>
        value.includes("term-link"),
      );
      expect(rowHtml).toContain("a=1&amp;b=2");
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "https://example.com/?a=1&b=2",
      );
    });

    it("does not merge adjacent links with different semantic keys", () => {
      const grid = [
        [
          { ...makeCell("A"), linkUri: "https://example.com", linkKey: "a" },
          { ...makeCell("B"), linkUri: "https://example.com", linkKey: "b" },
        ],
      ];
      const bridge = createMockBridge(2, 1, grid);
      bridge.getCursor = () => ({ row: 0, col: 2, visible: false });
      new Renderer(container).render(bridge as any);

      expect(container.querySelectorAll("a.term-link")).toHaveLength(2);
    });

    it("keeps one anchor across styled, wide, block, and cursor spans", () => {
      const linked = {
        linkUri: "https://example.com/mixed",
        linkKey: "mixed",
      };
      const grid = [
        [
          { ...makeCell("A"), ...linked },
          { ...makeCell("B", 1), ...linked },
          {
            ...makeCell(String.fromCodePoint(0x1f4c1), 256, 256, 0, 2),
            ...linked,
          },
          { char: 0, fg: 256, bg: 256, flags: 0, width: 0, ...linked },
          { ...makeCell("▀"), ...linked },
        ],
      ];
      const bridge = createMockBridge(5, 1, grid);
      bridge.getCursor = () => ({ row: 0, col: 1, visible: true });
      new Renderer(container).render(bridge as any);

      const links = container.querySelectorAll("a.term-link");
      expect(links).toHaveLength(1);
      expect(links[0].querySelector(".term-cursor")?.textContent).toBe("B");
      expect(links[0].querySelector(".term-wide")).not.toBeNull();
      expect(links[0].querySelector(".term-block")).not.toBeNull();
    });

    it("renders text content from bridge cells", () => {
      const grid = [[makeCell("H"), makeCell("i")]];
      const bridge = createMockBridge(2, 1, grid);
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      const text = container.textContent;
      expect(text).toContain("H");
      expect(text).toContain("i");
    });

    it("renders a complete grapheme string from one cell", () => {
      const grid = [[{ ...makeCell("e"), chars: "e\u0301" }]];
      const bridge = createMockBridge(1, 1, grid);
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      expect(container.querySelector(".term-row")?.textContent).toBe("e\u0301");
    });

    it("keeps the cursor on the grapheme's grid cell", () => {
      const grid = [[{ ...makeCell("e"), chars: "e\u0301" }, makeCell("x")]];
      const bridge = createMockBridge(2, 1, grid);
      bridge.getCursor = () => ({ row: 0, col: 1, visible: true });
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      expect(container.querySelector(".term-cursor")?.textContent).toBe("x");
    });

    it("renders wide cells once and skips continuation cells", () => {
      const grid = [
        [
          makeCell(String.fromCodePoint(0x1f4c1), 256, 256, 0, 2),
          { char: 0, fg: 256, bg: 256, flags: 0, width: 0 },
          makeCell("a"),
          makeCell("b"),
        ],
      ];
      const bridge = createMockBridge(4, 1, grid);
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      const row = container.querySelector(".term-row");
      expect(row?.textContent).toBe(`${String.fromCodePoint(0x1f4c1)}ab`);
      expect(container.querySelector(".term-wide")?.textContent).toBe(
        String.fromCodePoint(0x1f4c1),
      );
    });

    it("places the cursor correctly after a wide cell", () => {
      const grid = [
        [
          makeCell(String.fromCodePoint(0x1f4c1), 256, 256, 0, 2),
          { char: 0, fg: 256, bg: 256, flags: 0, width: 0 },
          makeCell("a"),
          makeCell("b"),
        ],
      ];
      const bridge = createMockBridge(4, 1, grid);
      bridge.getCursor = () => ({ row: 0, col: 3, visible: true });
      const renderer = new Renderer(container);
      renderer.render(bridge as any);

      expect(container.querySelector(".term-cursor")?.textContent).toBe("b");
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

    it("escapes double quotes before assigning to innerHTML", () => {
      const grid = [[makeCell('"')]];
      const bridge = createMockBridge(1, 1, grid);
      const renderer = new Renderer(container);

      let proto = Object.getPrototypeOf(container);
      while (proto && !Object.getOwnPropertyDescriptor(proto, "innerHTML")) {
        proto = Object.getPrototypeOf(proto);
      }
      const descriptor = Object.getOwnPropertyDescriptor(proto, "innerHTML")!;
      const assignedValues: string[] = [];
      Object.defineProperty(proto, "innerHTML", {
        ...descriptor,
        set(value: string) {
          assignedValues.push(value);
          descriptor.set!.call(this, value);
        },
      });

      try {
        renderer.render(bridge as any);
      } finally {
        Object.defineProperty(proto, "innerHTML", descriptor);
      }

      const rowHtml = assignedValues.find((v) => v.includes('">'));
      expect(rowHtml).toContain("&quot;");
      expect(container.querySelector(".term-row")?.textContent).toBe('"');
    });

    it("bounds materialized scrollback rows to the visible window", () => {
      const bridge = createMockBridge(4, 3);
      bridge.getScrollbackCount = () => 1000;
      bridge.getScrollbackLineLen = () => 4;
      bridge.getScrollbackCell = (offset: number) =>
        makeCell(String(offset % 10));
      const renderer = new Renderer(container);

      renderer.render(bridge as any, {
        scrollTop: 5000,
        clientHeight: 100,
        rowHeight: 10,
        overscanRows: 10,
      });

      expect(container.querySelectorAll(".term-scrollback-row").length).toBe(
        30,
      );
      expect(container.querySelectorAll(".term-row").length).toBe(33);
    });

    it("refreshes visible scrollback when a full ring rolls over", () => {
      let prefix = "A";
      let discardedCount = 0;
      const bridge = createMockBridge(2, 1);
      bridge.getScrollbackCount = () => 1000;
      bridge.getScrollbackLineLen = () => 2;
      bridge.getScrollbackCell = () => makeCell(prefix);
      const renderer = new Renderer(container);
      const viewport = {
        scrollTop: 5000,
        clientHeight: 20,
        rowHeight: 10,
        overscanRows: 1,
        scrollbackDiscardedCount: discardedCount,
      };

      renderer.render(bridge as any, viewport);
      expect(container.querySelector(".term-scrollback-row")?.textContent).toBe(
        "AA",
      );

      prefix = "B";
      discardedCount = 1;
      renderer.render(bridge as any, {
        ...viewport,
        scrollbackDiscardedCount: discardedCount,
      });
      expect(container.querySelector(".term-scrollback-row")?.textContent).toBe(
        "BB",
      );
    });

    it("refreshes visible scrollback without an optional rollover signal", () => {
      let prefix = "A";
      const bridge = createMockBridge(2, 1);
      bridge.getScrollbackCount = () => 1000;
      bridge.getScrollbackLineLen = () => 2;
      bridge.getScrollbackCell = () => makeCell(prefix);
      const renderer = new Renderer(container);
      const viewport = {
        scrollTop: 5000,
        clientHeight: 20,
        rowHeight: 10,
        overscanRows: 1,
      };

      renderer.render(bridge as any, viewport);
      expect(container.querySelector(".term-scrollback-row")?.textContent).toBe(
        "AA",
      );

      prefix = "B";
      renderer.render(bridge as any, viewport);

      expect(container.querySelector(".term-scrollback-row")?.textContent).toBe(
        "BB",
      );
    });

    it("preserves unchanged visible scrollback row elements", () => {
      const bridge = createMockBridge(2, 1);
      bridge.getScrollbackCount = () => 1000;
      bridge.getScrollbackLineLen = () => 2;
      bridge.getScrollbackCell = () => makeCell("A");
      const renderer = new Renderer(container);
      const viewport = {
        scrollTop: 5000,
        clientHeight: 20,
        rowHeight: 10,
        overscanRows: 1,
      };

      renderer.render(bridge as any, viewport);
      const row = container.querySelector(".term-scrollback-row");
      renderer.render(bridge as any, viewport);

      expect(container.querySelector(".term-scrollback-row")).toBe(row);
    });

    it("preserves retained row elements across rollover", () => {
      const history = ["A", "B", "C", "D", "E"];
      let discardedCount = 0;
      const bridge = createMockBridge(1, 1);
      bridge.getScrollbackCount = () => history.length;
      bridge.getScrollbackLineLen = () => 1;
      bridge.getScrollbackCell = (offset: number) =>
        makeCell(history[history.length - 1 - offset]);
      const renderer = new Renderer(container);
      const viewport = {
        scrollTop: 0,
        clientHeight: 50,
        rowHeight: 10,
        overscanRows: 0,
        scrollbackDiscardedCount: discardedCount,
      };

      renderer.render(bridge as any, viewport);
      const retainedRow = Array.from(
        container.querySelectorAll(".term-scrollback-row"),
      ).find((row) => row.textContent === "D");
      history.splice(0, 3);
      history.push("F", "G", "H");
      discardedCount = 3;
      renderer.render(bridge as any, {
        ...viewport,
        scrollbackDiscardedCount: discardedCount,
      });

      expect(
        Array.from(container.querySelectorAll(".term-scrollback-row")).find(
          (row) => row.textContent === "D",
        ),
      ).toBe(retainedRow);
    });

    it("does not reread scrollback when history and window are unchanged", () => {
      const bridge = createMockBridge(2, 1);
      bridge.getScrollbackCount = () => 1000;
      bridge.getScrollbackLineLen = () => 2;
      let reads = 0;
      bridge.getScrollbackCell = () => {
        reads++;
        return makeCell("A");
      };
      const renderer = new Renderer(container);
      const viewport = {
        scrollTop: 5000,
        clientHeight: 20,
        rowHeight: 10,
        overscanRows: 1,
        scrollbackDiscardedCount: 0,
      };

      renderer.render(bridge as any, viewport);
      const firstReads = reads;
      renderer.render(bridge as any, viewport);

      expect(firstReads).toBeGreaterThan(0);
      expect(reads).toBe(firstReads);
    });

    it("expands the window while a terminal selection is active", () => {
      const bridge = createMockBridge(1, 1);
      bridge.getScrollbackCount = () => 100;
      bridge.getScrollbackLineLen = () => 1;
      bridge.getScrollbackCell = () => makeCell("A");
      const renderer = new Renderer(container);
      const viewport = {
        scrollTop: 0,
        clientHeight: 20,
        rowHeight: 10,
        overscanRows: 0,
      };

      renderer.render(bridge as any, viewport);
      const firstRow = container.querySelector(".term-scrollback-row")!;
      const selection = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(firstRow);
      selection.removeAllRanges();
      selection.addRange(range);
      selection.extend(firstRow, 1);

      renderer.render(bridge as any, { ...viewport, scrollTop: 100 });

      expect(container.contains(firstRow)).toBe(true);
      expect(container.querySelectorAll(".term-scrollback-row").length).toBe(
        12,
      );
      selection.removeAllRanges();
    });
  });
});
