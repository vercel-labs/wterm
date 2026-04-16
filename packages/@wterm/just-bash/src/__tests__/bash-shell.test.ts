import { describe, it, expect, beforeEach, vi } from "vitest";
import { BashShell } from "../index.js";

const mockExec = vi.fn();

vi.mock("just-bash", () => {
  class MockBash {
    exec = mockExec;
    constructor(_opts?: any) {}
  }
  return { Bash: MockBash };
});

describe("BashShell", () => {
  let shell: BashShell;
  let output: string[];
  let write: (data: string) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    output = [];
    write = (data: string) => output.push(data);
    mockExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  });

  describe("constructor", () => {
    it("uses default options", () => {
      shell = new BashShell();
      expect(shell.cwd).toBe("/home/user");
    });

    it("accepts custom cwd", () => {
      shell = new BashShell({ cwd: "/tmp" });
      expect(shell.cwd).toBe("/tmp");
    });

    it("starts with null bash", () => {
      shell = new BashShell();
      expect(shell.bash).toBeNull();
    });
  });

  describe("attach", () => {
    it("initializes bash and shows prompt", async () => {
      shell = new BashShell();
      await shell.attach(write);

      expect(shell.bash).not.toBeNull();
      const joined = output.join("");
      expect(joined).toContain("$");
    });

    it("shows greeting before prompt", async () => {
      shell = new BashShell({ greeting: "Welcome!" });
      await shell.attach(write);

      expect(output[0]).toContain("Welcome!");
    });

    it("shows multi-line greeting", async () => {
      shell = new BashShell({ greeting: ["Line 1", "Line 2"] });
      await shell.attach(write);

      const greeting = output[0];
      expect(greeting).toContain("Line 1");
      expect(greeting).toContain("Line 2");
    });

    it("shows no greeting when empty array", async () => {
      shell = new BashShell({ greeting: [] });
      await shell.attach(write);

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("$");
    });
  });

  describe("handleInput - printable characters", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("echoes typed character", async () => {
      await shell.handleInput("a");
      expect(output).toContain("a");
    });

    it("inserts at cursor position", async () => {
      await shell.handleInput("h");
      await shell.handleInput("i");
      expect(output.join("")).toContain("hi");
    });
  });

  describe("handleInput - Enter", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("sends CRLF and reprints prompt on empty", async () => {
      await shell.handleInput("\r");
      expect(output[0]).toBe("\r\n");
      const joined = output.join("");
      expect(joined).toContain("$");
    });

    it("executes command via bash.exec", async () => {
      mockExec.mockResolvedValue({
        stdout: "hello\n",
        stderr: "",
        exitCode: 0,
      });
      await shell.handleInput("l");
      await shell.handleInput("s");
      await shell.handleInput("\r");

      expect(mockExec).toHaveBeenCalled();
      const calls = mockExec.mock.calls;
      const execCall = calls.find(
        (c: string[]) => typeof c[0] === "string" && c[0].includes("ls"),
      );
      expect(execCall).toBeDefined();
    });

    it("writes stdout to terminal", async () => {
      mockExec
        .mockResolvedValueOnce({
          stdout: "file.txt\n",
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: "/home/user\n",
          stderr: "",
          exitCode: 0,
        });

      await shell.handleInput("l");
      await shell.handleInput("s");
      await shell.handleInput("\r");

      const joined = output.join("");
      expect(joined).toContain("file.txt");
    });

    it("writes stderr in red", async () => {
      mockExec
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "not found",
          exitCode: 1,
        })
        .mockResolvedValueOnce({
          stdout: "/home/user\n",
          stderr: "",
          exitCode: 0,
        });

      await shell.handleInput("x");
      await shell.handleInput("\r");

      const joined = output.join("");
      expect(joined).toContain("not found");
      expect(joined).toContain("\x1b[31m");
    });

    it("adds command to history", async () => {
      mockExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
      await shell.handleInput("e");
      await shell.handleInput("c");
      await shell.handleInput("h");
      await shell.handleInput("o");
      await shell.handleInput("\r");

      output.length = 0;
      await shell.handleInput("\x1b[A");
      const joined = output.join("");
      expect(joined).toContain("echo");
    });
  });

  describe("handleInput - backspace", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("deletes character before cursor", async () => {
      await shell.handleInput("a");
      await shell.handleInput("b");
      output.length = 0;
      await shell.handleInput("\x7f");
      expect(output.join("")).toContain("\b");
    });

    it("does nothing at start of line", async () => {
      await shell.handleInput("\x7f");
      expect(output).toHaveLength(0);
    });
  });

  describe("handleInput - arrow keys", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("moves cursor left", async () => {
      await shell.handleInput("a");
      output.length = 0;
      await shell.handleInput("\x1b[D");
      expect(output.join("")).toContain("\x1b[D");
    });

    it("moves cursor right", async () => {
      await shell.handleInput("a");
      await shell.handleInput("\x1b[D");
      output.length = 0;
      await shell.handleInput("\x1b[C");
      expect(output.join("")).toContain("\x1b[C");
    });

    it("does not move left past start", async () => {
      await shell.handleInput("\x1b[D");
      expect(output).toHaveLength(0);
    });

    it("does not move right past end", async () => {
      await shell.handleInput("\x1b[C");
      expect(output).toHaveLength(0);
    });
  });

  describe("handleInput - history navigation", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      mockExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
      await shell.handleInput("first");
      await shell.handleInput("\r");
      await shell.handleInput("second");
      await shell.handleInput("\r");
      output.length = 0;
    });

    it("navigates up to previous command", async () => {
      await shell.handleInput("\x1b[A");
      const joined = output.join("");
      expect(joined).toContain("second");
    });

    it("navigates up twice to older command", async () => {
      await shell.handleInput("\x1b[A");
      await shell.handleInput("\x1b[A");
      const joined = output.join("");
      expect(joined).toContain("first");
    });

    it("navigates down to clear line", async () => {
      await shell.handleInput("\x1b[A");
      output.length = 0;
      await shell.handleInput("\x1b[B");
      const joined = output.join("");
      expect(joined).toContain("\x1b[K");
    });
  });

  describe("handleInput - control sequences", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("Ctrl+U clears the line", async () => {
      await shell.handleInput("hello");
      output.length = 0;
      await shell.handleInput("\x15");
      const joined = output.join("");
      expect(joined).toContain("\x1b[K");
    });

    it("Ctrl+C aborts and reprints prompt", async () => {
      await shell.handleInput("partial");
      output.length = 0;
      await shell.handleInput("\x03");
      const joined = output.join("");
      expect(joined).toContain("^C");
      expect(joined).toContain("$");
    });

    it("Ctrl+A moves to beginning of line", async () => {
      await shell.handleInput("text");
      output.length = 0;
      await shell.handleInput("\x01");
      const joined = output.join("");
      expect(joined).toContain("\x1b[");
    });

    it("Ctrl+E moves to end of line", async () => {
      await shell.handleInput("text");
      await shell.handleInput("\x01");
      output.length = 0;
      await shell.handleInput("\x05");
      const joined = output.join("");
      expect(joined).toContain("\x1b[");
    });

    it("Ctrl+L clears screen and reprints", async () => {
      await shell.handleInput("cmd");
      output.length = 0;
      await shell.handleInput("\x0c");
      const joined = output.join("");
      expect(joined).toContain("\x1b[2J");
      expect(joined).toContain("cmd");
    });
  });

  describe("handleInput - line continuation", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("buffers continued lines ending with backslash", async () => {
      await shell.handleInput("echo \\");
      await shell.handleInput("\r");
      const joined = output.join("");
      expect(joined).toContain("> ");
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe("handleInput - multi-char paste", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("processes pasted multi-character strings", async () => {
      await shell.handleInput("abc");
      const joined = output.join("");
      expect(joined).toContain("a");
      expect(joined).toContain("b");
      expect(joined).toContain("c");
    });
  });

  describe("custom prompt", () => {
    it("uses custom prompt function", async () => {
      shell = new BashShell({
        prompt: (cwd) => `[${cwd}]> `,
      });
      await shell.attach(write);
      const joined = output.join("");
      expect(joined).toContain("[/home/user]> ");
    });
  });
});
