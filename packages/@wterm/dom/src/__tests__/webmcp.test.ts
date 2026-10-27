import { WasmBridge } from "@wterm/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WTerm, type WTermOptions } from "../wterm.js";
import { parseKey } from "../webmcp.js";

interface Tool {
  name: string;
  annotations: { readOnlyHint: boolean; untrustedContentHint?: boolean };
  execute: (
    input: Record<string, unknown>,
    context?: { signal?: AbortSignal },
  ) => Promise<string>;
}

/** Mirrors a native provider: names are unique and aborting unregisters. */
const tools = new Map<string, Tool>();
const modelContext = {
  registerTool: vi.fn(
    async (tool: Tool, options?: { signal?: AbortSignal }) => {
      if (tools.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`);
      tools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => tools.delete(tool.name));
    },
  ),
};

const terminals: WTerm[] = [];

async function terminal(options: WTermOptions = {}): Promise<WTerm> {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const wt = new WTerm(element, {
    core: await WasmBridge.load(),
    cols: 20,
    rows: 4,
    autoResize: false,
    webmcp: true,
    ...options,
  });
  terminals.push(wt);
  await wt.init();
  await registered();
  return wt;
}

const registered = () => new Promise((resolve) => setTimeout(resolve, 0));

async function call(name: string, input: Record<string, unknown> = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`${name} is not registered`);
  return JSON.parse(await tool.execute(input));
}

afterEach(() => {
  for (const wt of terminals.splice(0)) {
    wt.destroy();
    wt.element.remove();
  }
});

describe("WebMCP", () => {
  it("does nothing without a WebMCP provider", async () => {
    await terminal();
    expect(tools.size).toBe(0);
    Object.defineProperty(document, "modelContext", {
      value: modelContext,
      configurable: true,
    });
  });

  it("registers tools while an enabled terminal is alive", async () => {
    const wt = await terminal();
    expect([...tools.keys()].sort()).toEqual([
      "list_terminals",
      "press_terminal_keys",
      "read_terminal",
      "type_in_terminal",
    ]);
    expect(tools.get("read_terminal")!.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(tools.get("type_in_terminal")!.annotations.readOnlyHint).toBe(false);
    wt.destroy();
    expect(tools.size).toBe(0);
  });

  it("stays off unless enabled, and follows setWebMCP", async () => {
    const wt = await terminal({ webmcp: undefined });
    expect(tools.size).toBe(0);
    wt.setWebMCP({ name: "build", readOnly: true });
    await registered();
    expect([...tools.keys()].sort()).toEqual([
      "list_terminals",
      "read_terminal",
    ]);
    expect((await call("list_terminals")).terminals[0]).toMatchObject({
      name: "build",
      readOnly: true,
    });
    wt.setWebMCP(true);
    await registered();
    expect(tools.has("type_in_terminal")).toBe(true);
    wt.setWebMCP(false);
    expect(tools.size).toBe(0);
  });

  it("lists terminals with their state", async () => {
    const wt = await terminal({
      webmcp: { name: "shell", description: "Dev server" },
    });
    wt.write("\x1b]0;vim\x07hi");
    expect(await call("list_terminals")).toEqual({
      terminals: [
        {
          name: "shell",
          description: "Dev server",
          readOnly: false,
          focused: true,
          cols: 20,
          rows: 4,
          cursor: { row: 0, col: 2, visible: true },
          alternateScreen: false,
          scrollbackRows: 0,
          title: "vim",
        },
      ],
    });
  });

  it("reads the screen, or more rows of scrollback", async () => {
    const wt = await terminal();
    wt.write("one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n$ ");
    expect((await call("read_terminal")).text).toBe("three\nfour\nfive\n$");
    expect((await call("read_terminal", { lines: 50 })).text).toBe(
      "one\ntwo\nthree\nfour\nfive\n$",
    );
    // lines counts physical rows; the built-in core reports no soft wraps.
    wt.write("\r\n" + "x".repeat(30));
    expect((await call("read_terminal", { lines: 2 })).text).toBe(
      "x".repeat(20) + "\n" + "x".repeat(10),
    );
    expect((await call("read_terminal", { lines: 0 })).error).toContain(
      "lines must be an integer",
    );
  });

  it("counts lines up from the last text, not the bottom of the screen", async () => {
    const wt = await terminal({ rows: 6 });
    wt.write("one\r\ntwo\r\n$ ");
    expect((await call("read_terminal", { lines: 2 })).text).toBe("two\n$");
    wt.write("\x1b[6;1Hstatus\x1b[3;3H");
    expect((await call("read_terminal", { lines: 1 })).text).toBe("status");
  });

  it("waits for text, then for output to settle", async () => {
    const wt = await terminal();
    const pending = call("read_terminal", {
      waitFor: "done",
      waitForIdleMs: 30,
    });
    wt.write("working\r\n");
    setTimeout(() => wt.write("done\r\n"), 10);
    setTimeout(() => wt.write("$ "), 70);
    const result = await pending;
    expect(result.timedOut).toBeUndefined();
    expect(result.text).toBe("working\ndone\n$");
  });

  it("returns the current text when a wait times out", async () => {
    const wt = await terminal();
    wt.write("still going");
    const result = await call("read_terminal", {
      waitFor: "done",
      timeoutMs: 20,
    });
    expect(result).toMatchObject({ timedOut: true, text: "still going" });
  });

  it("rejects a wait the agent cancels", async () => {
    await terminal();
    const controller = new AbortController();
    const pending = tools
      .get("read_terminal")!
      .execute({ waitFor: "done" }, { signal: controller.signal });
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await expect(pending).rejects.toThrow("Cancelled");
  });

  it("types text through onData as user input", async () => {
    const onData = vi.fn();
    const wt = await terminal({ onData });
    expect(
      await call("type_in_terminal", { text: "ls -la", submit: true }),
    ).toEqual({ terminal: "terminal", typed: 6, submitted: true });
    expect(onData.mock.calls.map(([data]) => data)).toEqual(["ls -la", "\r"]);

    onData.mockClear();
    await call("type_in_terminal", { text: "a\nb" });
    expect(onData).toHaveBeenCalledWith("a\rb");

    onData.mockClear();
    wt.write("\x1b[?2004h");
    await call("type_in_terminal", { text: "a\nb\x1b[201~" });
    expect(onData).toHaveBeenCalledWith("\x1b[200~a\nb[201~\x1b[201~");
  });

  it("presses Enter apart from the text so it is not taken as a paste", async () => {
    const onData = vi.fn();
    await terminal({ onData });
    const pending = call("type_in_terminal", { text: "hello", submit: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onData.mock.calls).toEqual([["hello"]]);
    await pending;
    expect(onData.mock.calls).toEqual([["hello"], ["\r"]]);
  });

  it("does not submit when the agent cancels during the pause", async () => {
    const onData = vi.fn();
    await terminal({ onData });
    const controller = new AbortController();
    const pending = tools
      .get("type_in_terminal")!
      .execute({ text: "rm", submit: true }, { signal: controller.signal });
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await expect(pending).rejects.toThrow("Cancelled");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onData.mock.calls).toEqual([["rm"]]);
  });

  it("echoes typed text locally without onData", async () => {
    await terminal();
    await call("type_in_terminal", { text: "echo" });
    expect((await call("read_terminal")).text).toBe("echo");
  });

  it("presses keys in the terminal's current modes", async () => {
    const onData = vi.fn();
    const wt = await terminal({ onData });
    await call("press_terminal_keys", {
      keys: ["Ctrl+C", "ArrowUp", "Shift+Tab", "Esc", "F5", "q"],
    });
    expect(onData.mock.calls.map(([data]) => data)).toEqual([
      "\x03",
      "\x1b[A",
      "\x1b[Z",
      "\x1b",
      "\x1b[15~",
      "q",
    ]);

    onData.mockClear();
    wt.write("\x1b[?1h");
    await call("press_terminal_keys", { keys: ["Up"] });
    expect(onData).toHaveBeenCalledWith("\x1bOA");

    onData.mockClear();
    wt.write("\x1b[?1l\x1b[>1u");
    await call("press_terminal_keys", { keys: ["Ctrl+C", "Escape"] });
    expect(onData.mock.calls.map(([data]) => data)).toEqual([
      "\x1b[99;5u",
      "\x1b[27u",
    ]);
  });

  it("rejects an unknown key before pressing any", async () => {
    const onData = vi.fn();
    await terminal({ onData });
    expect(
      (await call("press_terminal_keys", { keys: ["Enter", "Hyper+X"] })).error,
    ).toContain('Unknown key "Hyper+X"');
    expect(onData).not.toHaveBeenCalled();
  });

  it("addresses several terminals by name or focus", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = await terminal({ onData: first });
    const b = await terminal({ onData: second, webmcp: { name: "logs" } });
    const c = await terminal({ webmcp: { readOnly: true } });
    expect(
      (await call("list_terminals")).terminals.map(
        (t: { name: string }) => t.name,
      ),
    ).toEqual(["terminal", "logs", "terminal-2"]);

    b.focus();
    await call("type_in_terminal", { text: "x" });
    expect(second).toHaveBeenCalledWith("x");

    await call("type_in_terminal", { terminal: "terminal", text: "y" });
    expect(first).toHaveBeenCalledWith("y");

    (document.activeElement as HTMLElement).blur();
    expect((await call("read_terminal")).error).toContain(
      'Several terminals are open. Pass terminal as one of "terminal", "logs", "terminal-2".',
    );
    expect(
      (await call("type_in_terminal", { terminal: "terminal-2", text: "z" }))
        .error,
    ).toContain('Terminal "terminal-2" is read-only.');
    expect((await call("read_terminal", { terminal: "nope" })).error).toContain(
      'No terminal is named "nope"',
    );

    a.destroy();
    b.destroy();
    expect([...tools.keys()].sort()).toEqual([
      "list_terminals",
      "read_terminal",
    ]);
    c.destroy();
    expect(tools.size).toBe(0);
  });
});

describe("parseKey", () => {
  it("parses modifiers, names and characters", () => {
    expect(parseKey("ctrl+shift+a")).toEqual({
      key: "A",
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    });
    expect(parseKey("Alt++")?.key).toBe("+");
    expect(parseKey("space")?.key).toBe(" ");
    expect(parseKey("f12")?.key).toBe("F12");
    expect(parseKey("PgDn")?.key).toBe("PageDown");
    expect(parseKey("é")?.key).toBe("é");
    expect(parseKey("Banana")).toBeNull();
    expect(parseKey("Super+A")).toBeNull();
  });
});
