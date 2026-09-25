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
    mockExec.mockReset();
    output = [];
    write = (data: string) => output.push(data);
    mockExec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      env: { PWD: "/home/user" },
    });
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

  describe("handleInput - tab completion", () => {
    const mockCandidates = (names: string, directory = false) => {
      mockExec.mockImplementation(async (script: string) => ({
        stdout: script.startsWith("ls -1a")
          ? names
          : directory && script.startsWith("test -d")
            ? "DIR\n"
            : "",
        stderr: "",
        exitCode: 0,
      }));
    };

    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("completes the word at the cursor without moving trailing arguments", async () => {
      mockCandidates("file.txt\n");

      await shell.handleInput("cat fi --flag");
      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("\x1b[D");
      output.length = 0;
      await shell.handleInput("\t");
      expect(output).toEqual(["le.txt --flag\x1b[K", "\x1b[7D"]);
      await shell.handleInput("X");
      await shell.handleInput("\r");

      expect(mockExec.mock.calls.map(([script]) => script)).toContain(
        "cat file.txtX --flag",
      );
    });

    it("reuses a matching suffix and leaves the cursor after the completed word", async () => {
      mockCandidates("file.txt\n");

      await shell.handleInput("cat fi.txt");
      for (let i = 0; i < 4; i++) await shell.handleInput("\x1b[D");
      output.length = 0;
      await shell.handleInput("\t");
      expect(output).toEqual(["le.txt\x1b[K", "\x1b[4D", "\x1b[4C"]);
      await shell.handleInput("X");
      await shell.handleInput("\r");

      expect(mockExec.mock.calls.map(([script]) => script)).toContain(
        "cat file.txtX",
      );
    });

    it("keeps the cursor in place after listing ambiguous matches", async () => {
      mockCandidates("file\nfind\n");

      await shell.handleInput("cat fi 界");
      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("\x1b[D");
      output.length = 0;
      await shell.handleInput("\t");
      expect(output.at(-1)).toBe("\x1b[3D");

      await shell.handleInput("X");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls.map(([script]) => script)).toContain(
        "cat fiX 界",
      );
    });

    it("inserts a shared prefix before the text after the cursor", async () => {
      mockCandidates("fileA\nfileB\n");

      await shell.handleInput("cat fi end");
      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("\x1b[D");
      await shell.handleInput("\t");
      await shell.handleInput("X");
      await shell.handleInput("\r");

      expect(mockExec.mock.calls.map(([script]) => script)).toContain(
        "cat fileX end",
      );
    });

    it("does not duplicate a directory separator to the right of the cursor", async () => {
      mockCandidates("mydir\n", true);

      await shell.handleInput("cd my/sub");
      for (let i = 0; i < 4; i++) await shell.handleInput("\x1b[D");
      await shell.handleInput("\t");
      await shell.handleInput("\r");

      expect(mockExec.mock.calls.map(([script]) => script)).toContain(
        "cd mydir/sub",
      );
    });

    it("checks the completed directory at its expanded path", async () => {
      mockCandidates("Documents\n", true);

      await shell.handleInput("cd ~/Do");
      await shell.handleInput("\t");
      await shell.handleInput("\r");

      expect(mockExec.mock.calls.map(([script]) => script)).toContain(
        'test -d "/home/user/Documents" && echo DIR',
      );
      expect(mockExec.mock.calls.map(([script]) => script)).toContain(
        "cd ~/Documents/",
      );
    });

    it("does not apply a completion after the line changes during lookup", async () => {
      let finishLookup!: (result: {
        stdout: string;
        stderr: string;
        exitCode: number;
      }) => void;
      mockExec.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLookup = resolve;
          }),
      );

      await shell.handleInput("cat fi");
      const completion = shell.handleInput("\t");
      await shell.handleInput("x");
      finishLookup({ stdout: "file.txt\n", stderr: "", exitCode: 0 });
      await completion;
      await shell.handleInput("\r");

      expect(mockExec.mock.calls.map(([script]) => script)).toContain(
        "cat fix",
      );
    });

    it("does not apply an old completion after Enter clears an empty line", async () => {
      let finishLookup!: (result: {
        stdout: string;
        stderr: string;
        exitCode: number;
      }) => void;
      mockExec.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLookup = resolve;
          }),
      );

      const completion = shell.handleInput("\t");
      await shell.handleInput("\r");
      output.length = 0;
      finishLookup({ stdout: "file.txt\n", stderr: "", exitCode: 0 });
      await completion;

      expect(output).toEqual([]);
    });

    it("does not append a directory separator after the line changes during lookup", async () => {
      let finishLookup!: (result: {
        stdout: string;
        stderr: string;
        exitCode: number;
      }) => void;
      let lookupStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        lookupStarted = resolve;
      });
      mockExec.mockImplementation((script: string) => {
        if (script.startsWith("ls -1a")) {
          return Promise.resolve({
            stdout: "mydir\n",
            stderr: "",
            exitCode: 0,
          });
        }
        if (script.startsWith("test -d")) {
          return new Promise((resolve) => {
            finishLookup = resolve;
            lookupStarted();
          });
        }
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      });

      await shell.handleInput("cd my");
      const completion = shell.handleInput("\t");
      await started;
      await shell.handleInput("X");
      finishLookup({ stdout: "DIR\n", stderr: "", exitCode: 0 });
      await completion;
      await shell.handleInput("\r");

      expect(mockExec.mock.calls.map(([script]) => script)).toContain(
        "cd mydirX",
      );
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
      expect(mockExec).not.toHaveBeenCalled();
    });

    it("executes each command once with the current cwd", async () => {
      mockExec.mockResolvedValue({
        stdout: "hello\n",
        stderr: "",
        exitCode: 0,
        env: { PWD: "/home/user" },
      });
      await shell.handleInput("l");
      await shell.handleInput("s");
      await shell.handleInput("\r");

      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith("ls", {
        cwd: "/home/user",
        env: { PWD: "/home/user" },
      });
    });

    it("writes stdout to terminal", async () => {
      mockExec.mockResolvedValueOnce({
        stdout: "file.txt\n",
        stderr: "",
        exitCode: 0,
        env: { PWD: "/home/user" },
      });

      await shell.handleInput("l");
      await shell.handleInput("s");
      await shell.handleInput("\r");

      const joined = output.join("");
      expect(joined).toContain("file.txt");
    });

    it("writes stderr in red", async () => {
      mockExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "not found",
        exitCode: 1,
        env: { PWD: "/home/user" },
      });

      await shell.handleInput("x");
      await shell.handleInput("\r");

      const joined = output.join("");
      expect(joined).toContain("not found");
      expect(joined).toContain("\x1b[31m");
    });

    it("updates cwd and the prompt from result metadata", async () => {
      mockExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
        env: { PWD: "/tmp/project space $pecial" },
      });

      await shell.handleInput("cd /tmp");
      await shell.handleInput("\r");

      expect(shell.cwd).toBe("/tmp/project space $pecial");
      expect(output.join("")).toContain("/tmp/project space $pecial");

      await shell.handleInput("pwd");
      await shell.handleInput("\r");

      expect(mockExec).toHaveBeenLastCalledWith("pwd", {
        cwd: "/tmp/project space $pecial",
        env: { PWD: "/tmp/project space $pecial" },
      });
    });

    it("updates cwd metadata from a nonzero execution", async () => {
      mockExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 1,
        env: { PWD: "/tmp" },
      });

      await shell.handleInput("set -e; cd /tmp; false");
      await shell.handleInput("\r");

      expect(shell.cwd).toBe("/tmp");
      expect(output.join("")).toContain("/tmp");
    });

    it("preserves cwd when result metadata is absent or invalid", async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "",
          exitCode: 0,
          env: { PWD: "relative" },
        });

      await shell.handleInput("first");
      await shell.handleInput("\r");
      await shell.handleInput("second");
      await shell.handleInput("\r");

      expect(shell.cwd).toBe("/home/user");
    });

    it("recovers from a rejected execution", async () => {
      mockExec
        .mockRejectedValueOnce(new Error("execution failed"))
        .mockResolvedValueOnce({
          stdout: "recovered\n",
          stderr: "",
          exitCode: 0,
          env: { PWD: "/home/user" },
        });

      await shell.handleInput("broken");
      await shell.handleInput("\r");
      await shell.handleInput("working");
      await shell.handleInput("\r");

      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(output.join("")).toContain("execution failed");
      expect(output.join("")).toContain("recovered");
    });

    it("adds command to history", async () => {
      mockExec.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        env: { PWD: "/home/user" },
      });
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

    it("moves backward by words for Option+Left without inserting its escape sequence", async () => {
      await shell.handleInput("ls -la");
      output.length = 0;

      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("\x1b[1;3D");
      expect(output).toEqual(["\x1b[3D", "\x1b[3D"]);

      await shell.handleInput("\x1b[1;3C");
      await shell.handleInput("\x1b[1;3C");
      expect(output).toEqual(["\x1b[3D", "\x1b[3D", "\x1b[2C", "\x1b[4C"]);
    });

    it("edits at the word boundary after Option+Left", async () => {
      await shell.handleInput("ls -la");
      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("X");
      await shell.handleInput("\r");

      expect(mockExec.mock.calls[0]?.[0]).toContain("ls X-la");
    });

    it("also accepts Ctrl+arrows and Alt+B/F for word navigation", async () => {
      await shell.handleInput("one two");
      output.length = 0;
      await shell.handleInput("\x1b[1;5D");
      await shell.handleInput("\x1bb");
      await shell.handleInput("\x1bf");
      await shell.handleInput("\x1b[1;5C");
      expect(output).toEqual(["\x1b[3D", "\x1b[4D", "\x1b[3C", "\x1b[4C"]);
    });

    it("does not insert unsupported functional-key sequences", async () => {
      await shell.handleInput("ls");
      output.length = 0;
      await shell.handleInput("\x1b[1;2D");
      expect(output).toEqual([]);

      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("ls");
      expect(mockExec.mock.calls[0]?.[0]).not.toContain("[1;2D");
    });

    it.each(["\x1b[H", "\x1bOH"])(
      "moves Home to the start of the line for %s",
      async (sequence) => {
        await shell.handleInput("echo hello");
        output.length = 0;
        await shell.handleInput(sequence);
        expect(output).toEqual(["\x1b[10D"]);

        await shell.handleInput("X");
        await shell.handleInput("\r");
        expect(mockExec.mock.calls[0]?.[0]).toContain("Xecho hello");
      },
    );

    it.each(["\x1b[F", "\x1bOF"])(
      "moves End to the end of the line for %s",
      async (sequence) => {
        await shell.handleInput("echo hi");
        await shell.handleInput("\x1b[H");
        output.length = 0;
        await shell.handleInput(sequence);
        expect(output).toEqual(["\x1b[7C"]);

        await shell.handleInput("!");
        await shell.handleInput("\r");
        expect(mockExec.mock.calls[0]?.[0]).toContain("echo hi!");
      },
    );

    it("deletes the character at the cursor and redraws the remaining text", async () => {
      await shell.handleInput("abc");
      await shell.handleInput("\x1b[H");
      await shell.handleInput("\x1b[C");
      output.length = 0;

      await shell.handleInput("\x1b[3~");
      expect(output).toEqual(["c\x1b[K", "\x1b[1D"]);
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("ac");
    });

    it("does not delete past the end of the line", async () => {
      await shell.handleInput("abc");
      output.length = 0;
      await shell.handleInput("\x1b[3~");
      expect(output).toEqual([]);
    });
  });

  describe("handleInput - history navigation", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      mockExec.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        env: { PWD: "/home/user" },
      });
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

    it("restores an unfinished command after browsing history", async () => {
      await shell.handleInput("draft");
      await shell.handleInput("\x1b[A");
      await shell.handleInput("\x1b[A");
      await shell.handleInput("\x1b[B");
      output.length = 0;

      await shell.handleInput("\x1b[B");
      expect(output.join("")).toContain("\x1b[Kdraft");

      const callCount = mockExec.mock.calls.length;
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[callCount]?.[0]).toContain("draft");
    });

    it("restores the draft cursor position so typing resumes in place", async () => {
      await shell.handleInput("echo hi");
      await shell.handleInput("\x1b[D");
      await shell.handleInput("\x1b[D");
      await shell.handleInput("\x1b[A");
      output.length = 0;

      await shell.handleInput("\x1b[B");
      expect(output.at(-1)).toBe("\x1b[2D");

      await shell.handleInput("X");
      const callCount = mockExec.mock.calls.length;
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[callCount]?.[0]).toContain("echo Xhi");
    });

    it("discards the saved draft when Ctrl+C cancels history browsing", async () => {
      await shell.handleInput("draft");
      await shell.handleInput("\x1b[A");
      await shell.handleInput("\x03");
      output.length = 0;

      await shell.handleInput("\x1b[B");
      expect(output).toEqual([]);
    });
  });

  describe("handleInput - control sequences", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("Ctrl+U erases the line before the cursor", async () => {
      await shell.handleInput("hello");
      output.length = 0;
      await shell.handleInput("\x15");
      expect(output).toEqual(["\x1b[5D\x1b[K"]);

      await shell.handleInput("again");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("again");
    });

    it.each([
      ["Option+Backspace", "\x1b\x7f"],
      ["Alt+Backspace using BS", "\x1b\b"],
      ["Ctrl+W", "\x17"],
    ])(
      "%s erases the preceding word and leaves the suffix",
      async (_key, sequence) => {
        await shell.handleInput("echo alpha beta");
        await shell.handleInput("\x1b[1;3D");
        output.length = 0;

        await shell.handleInput(sequence);
        expect(output).toEqual(["\x1b[6Dbeta\x1b[K", "\x1b[4D"]);

        await shell.handleInput("X");
        await shell.handleInput("\r");
        expect(mockExec.mock.calls[0]?.[0]).toContain("echo Xbeta");
      },
    );

    it("word erase skips trailing whitespace and stops at the line start", async () => {
      await shell.handleInput("echo alpha  ");
      output.length = 0;

      await shell.handleInput("\x17");
      expect(output).toEqual(["\x1b[7D\x1b[K"]);
      output.length = 0;
      await shell.handleInput("\x15");
      await shell.handleInput("\x17");
      expect(output).toEqual(["\x1b[5D\x1b[K"]);
    });

    it("Ctrl+U preserves the text after the cursor", async () => {
      await shell.handleInput("echo alpha beta");
      await shell.handleInput("\x1b[1;3D");
      output.length = 0;

      await shell.handleInput("\x15");
      expect(output).toEqual(["\x1b[11Dbeta\x1b[K", "\x1b[4D"]);

      await shell.handleInput("X");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("Xbeta");
    });

    it("Ctrl+K erases the text after the cursor", async () => {
      await shell.handleInput("echo alpha beta");
      await shell.handleInput("\x1b[1;3D");
      output.length = 0;

      await shell.handleInput("\x0b");
      expect(output).toEqual(["\x1b[K"]);

      await shell.handleInput("X");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo alpha X");
    });

    it("Ctrl+K at the end and Ctrl+U at the start leave the line alone", async () => {
      await shell.handleInput("echo hi");
      output.length = 0;
      await shell.handleInput("\x0b");
      await shell.handleInput("\x01");
      output.length = 0;
      await shell.handleInput("\x15");
      expect(output).toEqual([]);

      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo hi");
    });

    it("Ctrl+Y restores a word erased before the cursor", async () => {
      await shell.handleInput("echo alpha beta");
      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("\x17");
      output.length = 0;

      await shell.handleInput("\x19");
      expect(output).toEqual(["alpha beta\x1b[K", "\x1b[4D"]);

      await shell.handleInput("X");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo alpha Xbeta");
    });

    it("Ctrl+Y restores text erased after the cursor", async () => {
      await shell.handleInput("echo alpha beta");
      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("\x0b");
      output.length = 0;

      await shell.handleInput("\x19");
      expect(output).toEqual(["beta"]);

      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo alpha beta");
    });

    it("combines consecutive backward erasures in their original order", async () => {
      await shell.handleInput("echo one two three");
      await shell.handleInput("\x17");
      await shell.handleInput("\x1b\x7f");
      output.length = 0;

      await shell.handleInput("\x19");
      expect(output).toEqual(["two three"]);

      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo one two three");
    });

    it("Ctrl+U joins a preceding word erasure for Ctrl+Y", async () => {
      await shell.handleInput("echo one two");
      await shell.handleInput("\x17");
      await shell.handleInput("\x15");
      output.length = 0;

      await shell.handleInput("\x19");
      expect(output).toEqual(["echo one two"]);
    });

    it.each([
      ["Ctrl+K then Ctrl+U", ["\x0b", "\x15"]],
      ["Ctrl+U then Ctrl+K", ["\x15", "\x0b"]],
    ])("%s restores the original order with Ctrl+Y", async (_key, keys) => {
      await shell.handleInput("echo one two");
      await shell.handleInput("\x1b[1;3D");
      for (const key of keys) await shell.handleInput(key);
      output.length = 0;

      await shell.handleInput("\x19");
      expect(output).toEqual(["echo one two"]);
    });

    it("Ctrl+Y keeps the previous erasure through ordinary edits", async () => {
      await shell.handleInput("echo alpha");
      await shell.handleInput("\x17");
      await shell.handleInput("x");
      await shell.handleInput("\x7f");
      output.length = 0;

      await shell.handleInput("\x19");
      expect(output).toEqual(["alpha"]);
    });

    it("ordinary edits start a new consecutive erasure group", async () => {
      await shell.handleInput("echo one two");
      await shell.handleInput("\x17");
      await shell.handleInput("x");
      await shell.handleInput("\x17");
      output.length = 0;

      await shell.handleInput("\x19");
      expect(output).toEqual(["x"]);
    });

    it("Backspace and Delete do not replace the text restored by Ctrl+Y", async () => {
      await shell.handleInput("echo alpha");
      await shell.handleInput("\x17");
      await shell.handleInput("xy");
      await shell.handleInput("\x7f");
      await shell.handleInput("\x1b[D");
      await shell.handleInput("\x1b[3~");
      output.length = 0;

      await shell.handleInput("\x19");
      expect(output).toEqual(["alpha"]);
    });

    it("Ctrl+Y is silent until text has been erased", async () => {
      await shell.handleInput("\x19");
      expect(output).toEqual([]);
    });

    it("Ctrl+Y does not restore ordinary Backspace or Delete edits", async () => {
      await shell.handleInput("ab");
      await shell.handleInput("\x7f");
      output.length = 0;
      await shell.handleInput("\x19");
      expect(output).toEqual([]);

      await shell.handleInput("\x1b[D");
      await shell.handleInput("\x1b[3~");
      output.length = 0;
      await shell.handleInput("\x19");
      expect(output).toEqual([]);
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

    it("executes an assembled continued command once", async () => {
      await shell.handleInput("echo \\");
      await shell.handleInput("\r");
      await shell.handleInput("hello");
      await shell.handleInput("\r");

      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(`echo ${"\\"}\nhello`, {
        cwd: "/home/user",
        env: { PWD: "/home/user" },
      });
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

  describe("handleInput - Unicode editing", () => {
    beforeEach(async () => {
      shell = new BashShell();
      await shell.attach(write);
      output.length = 0;
    });

    it("accepts pasted emoji, combining marks, and CJK text as one command", async () => {
      await shell.handleInput("echo 👩‍💻 e\u0301 界");
      await shell.handleInput("\r");

      expect(mockExec.mock.calls[0]?.[0]).toContain("echo 👩‍💻 e\u0301 界");
    });

    it("moves across a joined emoji without splitting it", async () => {
      await shell.handleInput("echo 👩");
      await shell.handleInput("\u200d");
      await shell.handleInput("💻x");
      output.length = 0;

      await shell.handleInput("\x1b[D");
      await shell.handleInput("\x1b[D");
      await shell.handleInput("\x1b[C");
      expect(output).toEqual(["\x1b[D", "\x1b[2D", "\x1b[2C"]);

      await shell.handleInput("Y");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo 👩‍💻Yx");
    });

    it("backspaces a whole emoji and redraws the remaining text", async () => {
      await shell.handleInput("echo 👩‍💻!");
      await shell.handleInput("\x1b[D");
      output.length = 0;

      await shell.handleInput("\x7f");
      expect(output).toEqual(["\x1b[2D!\x1b[K", "\x1b[1D"]);

      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo !");
    });

    it("deletes a whole combining sequence at the cursor", async () => {
      await shell.handleInput("echo e");
      await shell.handleInput("\u0301");
      await shell.handleInput("x");
      await shell.handleInput("\x1b[D");
      await shell.handleInput("\x1b[D");
      output.length = 0;

      await shell.handleInput("\x1b[3~");
      expect(output).toEqual(["x\x1b[K", "\x1b[1D"]);

      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo x");
    });

    it("uses cell widths when inserting before wide text and moving by word", async () => {
      await shell.handleInput("echo 界 👩‍💻");
      output.length = 0;
      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("\x1b[1;3D");
      expect(output).toEqual(["\x1b[2D", "\x1b[3D"]);

      await shell.handleInput("X");
      expect(output.at(-1)).toBe("\x1b[5D");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo X界 👩‍💻");
    });

    it("erases a wide word without splitting it or moving into the suffix", async () => {
      await shell.handleInput("界 👩‍💻 xyz");
      await shell.handleInput("\x1b[1;3D");
      output.length = 0;

      await shell.handleInput("\x1b\x7f");
      expect(output).toEqual(["\x1b[3Dxyz\x1b[K", "\x1b[3D"]);

      await shell.handleInput("X");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("界 Xxyz");
    });

    it("Ctrl+U uses cell width when retaining a wide suffix", async () => {
      await shell.handleInput("echo 👩‍💻 界");
      await shell.handleInput("\x1b[1;3D");
      output.length = 0;

      await shell.handleInput("\x15");
      expect(output).toEqual(["\x1b[8D界\x1b[K", "\x1b[2D"]);

      await shell.handleInput("X");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("X界");
    });

    it("Ctrl+Y restores a wide erased prefix before the remaining text", async () => {
      await shell.handleInput("echo 👩‍💻 界");
      await shell.handleInput("\x1b[1;3D");
      await shell.handleInput("\x15");
      output.length = 0;

      await shell.handleInput("\x19");
      expect(output).toEqual(["echo 👩‍💻 界\x1b[K", "\x1b[2D"]);

      await shell.handleInput("X");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo 👩‍💻 X界");
    });

    it("moves Home and End by displayed columns", async () => {
      await shell.handleInput("A界👩‍💻");
      output.length = 0;

      await shell.handleInput("\x1b[H");
      await shell.handleInput("\x1b[F");
      expect(output).toEqual(["\x1b[5D", "\x1b[5C"]);
    });

    it("handles an emoji in a paste that also contains Enter", async () => {
      await shell.handleInput("echo 👋\r");
      expect(mockExec.mock.calls[0]?.[0]).toContain("echo 👋");
    });

    it("restores the cell position of a draft after visiting history", async () => {
      await shell.handleInput("first");
      await shell.handleInput("\r");
      await shell.handleInput("echo 👩‍💻x");
      await shell.handleInput("\x1b[D");
      await shell.handleInput("\x1b[D");
      await shell.handleInput("\x1b[A");
      output.length = 0;

      await shell.handleInput("\x1b[B");
      expect(output.at(-1)).toBe("\x1b[3D");

      await shell.handleInput("Y");
      await shell.handleInput("\r");
      expect(mockExec.mock.calls[1]?.[0]).toContain("echo Y👩‍💻x");
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
