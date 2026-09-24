import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as pty from "node-pty";
import "./prepare-pty.mjs";

// Only deterministic, generated content is recorded. Never attach to a user's
// editor or tmux server, load their config, or read their working directory.
const root = await mkdtemp(join(tmpdir(), "wterm-record-"));
const destination = new URL("../fixtures/", import.meta.url);
const term = "xterm-256color";
const locale = process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
const env = {
  PATH: process.env.PATH || "/usr/bin:/bin",
  HOME: root,
  XDG_CONFIG_HOME: root,
  XDG_DATA_HOME: root,
  XDG_STATE_HOME: root,
  TERM: term,
  LC_ALL: locale,
  SHELL: "/bin/sh",
};
const terminfo = execFileSync("infocmp", ["-1", term], { env }).toString();
const require = createRequire(import.meta.url);
const metadata = {
  kind: "pty",
  capturedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  node: process.version,
  nodePty: require("node-pty/package.json").version,
  terminalResponses: "none; applications use TERM and terminfo",
  term,
  locale,
  terminfoSha256: createHash("sha256").update(terminfo).digest("hex"),
  terminfo,
  recorder: "e2e/harness/record-apps.mjs",
};
const active = new Set();
const socket = join(root, "tmux.sock");
const tmux = (...args) =>
  execFileSync("tmux", ["-S", socket, ...args], { env });

async function record(id, application, args, drive) {
  const version = execFileSync(
    application,
    [application === "tmux" ? "-V" : "--version"],
    { env, cwd: root },
  )
    .toString()
    .split("\n")[0];
  const events = [];
  const start = performance.now();
  const add = (event) =>
    events.push({ atMs: Math.round(performance.now() - start), ...event });
  const child = pty.spawn(application, args, {
    name: term,
    cols: 80,
    rows: 24,
    cwd: root,
    env,
    encoding: null,
  });
  active.add(child);
  let output = "";
  let lastOutput = performance.now();
  let exited = false;
  const exit = new Promise((resolve) =>
    child.onExit(() => {
      exited = true;
      active.delete(child);
      resolve();
    }),
  );
  child.onData((data) => {
    add({ type: "output", data: data.toString("base64") });
    output = (output + data.toString("utf8")).slice(-65536);
    lastOutput = performance.now();
  });
  const waitFor = async (text) => {
    const deadline = performance.now() + 10000;
    while (!output.includes(text) || performance.now() - lastOutput < 200) {
      if (exited || performance.now() > deadline)
        throw new Error(
          `${id}: waiting for ${JSON.stringify(text)}; tail=${JSON.stringify(output.slice(-500))}`,
        );
      await delay(25);
    }
    output = "";
  };
  const waitExit = async () => {
    const deadline = performance.now() + 10000;
    while (!exited) {
      if (performance.now() > deadline)
        throw new Error(`${id}: application did not exit`);
      await delay(25);
    }
  };
  try {
    await drive({
      waitFor,
      waitExit,
      input: (data) => {
        add({ type: "input", data });
        child.write(data);
      },
      resize: (cols, rows) => {
        add({ type: "resize", cols, rows });
        child.resize(cols, rows);
      },
      checkpoint: (name, expected) =>
        add({ type: "checkpoint", name, expected }),
    });
    await waitExit();
    await writeFile(
      new URL(`${id}.json`, destination),
      JSON.stringify(
        {
          schemaVersion: 1,
          id,
          source: { ...metadata, application, version },
          cols: 80,
          rows: 24,
          events,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Recorded ${id}: ${events.length} events`);
  } finally {
    if (!exited) child.kill("SIGKILL");
    await exit;
  }
}

try {
  await mkdir(destination, { recursive: true });
  await writeFile(
    join(root, "sample.txt"),
    "wterm replay\nwide: 界 café\neditor changes survive resize\n",
  );
  await writeFile(
    join(root, "init.vim"),
    [
      "set nocompatible noswapfile nobackup nowritebackup nomodeline",
      "set noshowmode noruler noshowcmd laststatus=0 shortmess+=I",
      "set nonumber norelativenumber signcolumn=no foldcolumn=0",
      "set notermguicolors background=dark",
      "syntax off",
    ].join("\n"),
  );
  await record(
    "neovim-edit",
    "nvim",
    ["-u", "init.vim", "-n", "-i", "NONE", "sample.txt"],
    async ({ waitFor, waitExit, input, resize, checkpoint }) => {
      await waitFor("editor changes survive resize");
      checkpoint("open file", {
        rows: {
          0: "wterm replay",
          1: "wide: 界 café",
          2: "editor changes survive resize",
        },
        cursor: { row: 0, col: 0 },
        modes: { alternateScreen: true },
        cells: [
          { row: 1, col: 6, value: { char: 30028, width: 2 } },
          { row: 1, col: 7, value: { width: 0 } },
        ],
      });
      input("ggIrecorded: \x1b");
      await waitFor("recorded:");
      checkpoint("insert text", {
        rows: { 0: "recorded: wterm replay" },
        cursor: { row: 0, col: 9 },
      });
      resize(52, 16);
      await waitFor("editor changes survive resize");
      checkpoint("narrow editor", {
        cols: 52,
        height: 16,
        rows: { 0: "recorded: wterm replay", 1: "wide: 界 café" },
        cursor: { row: 0, col: 9 },
      });
      resize(80, 24);
      await waitFor("editor changes survive resize");
      checkpoint("wide editor", {
        cols: 80,
        height: 24,
        rows: {
          0: "recorded: wterm replay",
          2: "editor changes survive resize",
        },
        modes: { alternateScreen: true },
      });
      input(":qa!\r");
      await waitExit();
      checkpoint("editor exit", { modes: { alternateScreen: false } });
    },
  );

  await writeFile(
    join(root, "tmux.conf"),
    [
      "set -g status off",
      "set -g default-terminal xterm-256color",
      "set -g default-shell /bin/sh",
      "set -g set-titles off",
      "set -g escape-time 0",
    ].join("\n"),
  );
  // Controlled shell contents, no profiles and no generated paths in the output.
  await writeFile(
    join(root, "pane.sh"),
    "printf '\\033[2J\\033[Hpane one: 界 café\\r\\n'\nwhile IFS= read -r line; do printf 'received: %s\\n' \"$line\"; done\n",
  );
  await record(
    "tmux-pane",
    "tmux",
    [
      "-S",
      socket,
      "-f",
      "tmux.conf",
      "new-session",
      "-s",
      "replay",
      "/bin/sh pane.sh",
    ],
    async ({ waitFor, waitExit, input, resize, checkpoint }) => {
      await waitFor("pane one:");
      checkpoint("pane output", {
        rows: { 0: "pane one: 界 café" },
        modes: { alternateScreen: true },
      });
      input("terminal input\r");
      await waitFor("received:");
      checkpoint("pane input", {
        rows: { 1: "terminal input", 2: "received: terminal input" },
      });
      resize(52, 16);
      await waitFor("received:");
      checkpoint("narrow pane", {
        cols: 52,
        height: 16,
        rows: { 0: "pane one: 界 café", 2: "received: terminal input" },
      });
      resize(80, 24);
      await waitFor("received:");
      checkpoint("wide pane", {
        cols: 80,
        height: 24,
        rows: { 0: "pane one: 界 café", 2: "received: terminal input" },
      });
      input("\x02d");
      await waitExit();
      checkpoint("pane detach", { modes: { alternateScreen: false } });
    },
  );
} finally {
  for (const child of active) child.kill("SIGKILL");
  try {
    tmux("kill-server");
  } catch {
    /* The private server may already have exited. */
  }
  await rm(root, { recursive: true, force: true });
}
