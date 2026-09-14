import { describe, expect, it } from "vitest";
import { BashShell, type ShellOptions } from "../index.js";

const customCwd = "/home/user/project space $pecial;[]";
const prompt = (cwd: string) => `[${cwd}]> `;

async function createShell(options: ShellOptions = {}) {
  const output: string[] = [];
  const shell = new BashShell({
    ...options,
    files: {
      "/home/user/.keep": "",
      "/tmp/.keep": "",
      ...options.files,
    },
    prompt,
  });
  await shell.attach((data) => output.push(data));
  output.length = 0;
  return { shell, output };
}

async function submit(shell: BashShell, command: string) {
  await shell.handleInput(command);
  await shell.handleInput("\r");
}

describe("BashShell with just-bash", () => {
  it("executes an append command once", async () => {
    const { shell } = await createShell();

    await submit(shell, "echo once >> /tmp/once.txt; true");

    expect(await shell.bash?.readFile("/tmp/once.txt")).toBe("once\n");
  });

  it("tracks the directory reached by a conditional's first execution", async () => {
    const { shell, output } = await createShell();

    await submit(
      shell,
      "if test -e /tmp/marker; then cd /home/user; else touch /tmp/marker; cd /tmp; fi",
    );

    expect(shell.cwd).toBe("/tmp");
    expect(output.join("")).toContain(prompt("/tmp"));
  });

  it("tracks a directory changed inside a function", async () => {
    const { shell, output } = await createShell();

    await submit(shell, "function go() { cd /tmp; }; go");

    expect(shell.cwd).toBe("/tmp");
    expect(output.join("")).toContain(prompt("/tmp"));

    output.length = 0;
    await submit(shell, "pwd");

    expect(output.join("")).toContain("/tmp\r\n");
    expect(output.join("")).toContain(prompt("/tmp"));
  });

  it("supports a custom cwd with shell-special characters and relative commands", async () => {
    const { shell, output } = await createShell({
      cwd: customCwd,
      files: {
        [`${customCwd}/.keep`]: "",
        [`${customCwd}/child/.keep`]: "",
      },
    });

    await submit(shell, "pwd");

    expect(shell.cwd).toBe(customCwd);
    expect(output.join("")).toContain(`${customCwd}\r\n`);
    expect(output.join("")).toContain(prompt(customCwd));

    output.length = 0;
    await submit(shell, "cd child");

    expect(shell.cwd).toBe(`${customCwd}/child`);
    expect(output.join("")).toContain(prompt(`${customCwd}/child`));

    output.length = 0;
    await submit(shell, "pwd");

    expect(output.join("")).toContain(`${customCwd}/child\r\n`);
    expect(output.join("")).toContain(prompt(`${customCwd}/child`));
  });

  it("updates cwd after a nonzero command and retains it after a failed cd", async () => {
    const { shell, output } = await createShell({
      cwd: customCwd,
      files: { [`${customCwd}/.keep`]: "" },
    });

    await submit(shell, "cd /tmp; false");

    expect(shell.cwd).toBe("/tmp");
    expect(output.join("")).toContain(prompt("/tmp"));

    output.length = 0;
    await submit(shell, "cd /does-not-exist");

    expect(shell.cwd).toBe("/tmp");
    expect(output.join("")).toContain("No such file or directory");
    expect(output.join("")).toContain(prompt("/tmp"));
  });

  it("preserves cwd through a syntax error and a following command", async () => {
    const { shell, output } = await createShell();

    await submit(shell, "cd /tmp");
    expect(shell.cwd).toBe("/tmp");

    output.length = 0;
    await submit(shell, "if");

    expect(shell.cwd).toBe("/tmp");
    expect(output.join("")).toContain("syntax error");
    expect(output.join("")).toContain(prompt("/tmp"));

    output.length = 0;
    await submit(shell, "pwd");

    expect(shell.cwd).toBe("/tmp");
    expect(output.join("")).toContain("/tmp\r\n");
    expect(output.join("")).toContain(prompt("/tmp"));
  });
});
