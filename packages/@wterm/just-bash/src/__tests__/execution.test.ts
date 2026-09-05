import { describe, expect, it } from "vitest";
import { BashShell } from "../index.js";

describe("BashShell execution", () => {
  it("applies a submitted command's side effects only once", async () => {
    const shell = new BashShell({ files: { "/home/user/log.txt": "" } });
    await shell.attach(() => {});

    await shell.handleInput("sh -c 'echo side-effect >> log.txt'");
    await shell.handleInput("\r");

    expect(await shell.bash!.readFile("/home/user/log.txt")).toBe(
      "side-effect\n",
    );
  });

  it("retains directory changes without replaying commands or changing output", async () => {
    const output: string[] = [];
    const shell = new BashShell({
      files: { "/home/user/seed.txt": "" },
      prompt: (cwd) => `[${cwd}]> `,
    });
    await shell.attach((data) => output.push(data));
    await shell.handleInput(
      "mkdir -p '/tmp/work dir' && cd '/tmp/work dir' && printf moved; false # trailing comment",
    );
    output.length = 0;
    await shell.handleInput("\r");
    expect(shell.cwd).toBe("/tmp/work dir");
    expect(output.join("")).toBe("\r\nmoved\r\n[/tmp/work dir]> ");

    await shell.handleInput("echo saved >> result.txt");
    await shell.handleInput("\r");
    expect(await shell.bash!.readFile("/tmp/work dir/result.txt")).toBe(
      "saved\n",
    );

    await shell.handleInput("cd /missing");
    await shell.handleInput("\r");
    expect(shell.cwd).toBe("/tmp/work dir");
    expect(output.join("")).toContain("No such file or directory");
  });
});
