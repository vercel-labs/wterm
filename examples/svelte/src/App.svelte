<script lang="ts">
  import { Terminal } from "@wterm/svelte";
  import type { WTerm } from "@wterm/svelte";
  import { BashShell } from "@wterm/just-bash";

  interface Theme {
    value: string;
    theme: string | undefined;
  }

  const THEMES: Theme[] = [
    { value: "Default", theme: undefined },
    { value: "Solarized Dark", theme: "solarized-dark" },
    { value: "Monokai", theme: "monokai" },
    { value: "Light", theme: "light" },
  ];

  const INITIAL_FILES: Record<string, string> = {
    "/home/user/README.md":
      "# wterm\n\nA terminal emulator for the web.\nRenders to the DOM — native text selection, copy/paste, and accessibility come for free.\nThe core is written in Zig and compiled to WASM.\n\nUses just-bash for shell execution.\n",
    "/home/user/package.json":
      '{\n  "name": "wterm",\n  "version": "0.1.0",\n  "description": "Terminal emulator for the web"\n}\n',
    "/home/user/src/main.zig":
      'const std = @import("std");\n\npub fn main() void {\n    std.debug.print("Hello from Zig!\\n", .{});\n}\n',
    "/home/user/examples/hello.sh":
      '#!/bin/bash\necho "Hello from wterm!"\necho "Date: $(date)"\necho "Shell: $SHELL"\n',
  };

  let bashTerminal: Terminal;
  let localTerminal: Terminal;
  let themeLabel = $state("Default");
  let title = $state("wterm");
  let shell: BashShell | null = null;
  let ws: WebSocket | null = null;

  const theme = $derived(
    THEMES.find((item) => item.value === themeLabel)?.theme,
  );

  function handleBashReady() {
    if (shell) return;
    shell = new BashShell({
      files: INITIAL_FILES,
      greeting: [
        "wterm — terminal emulator for the web",
        "Powered by just-bash · running entirely in the browser",
        "",
        "Type help for commands, or try: ls, cat README.md, bash examples/hello.sh",
        "",
      ],
    });
    shell.attach((data) => bashTerminal.write(data));
  }

  function handleBashData(data: string) {
    shell?.handleInput(data);
  }

  function handleTitle(nextTitle: string) {
    title = nextTitle;
  }

  function handleLocalReady(_wt: WTerm) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${window.location.host}/api/terminal`);
    ws = socket;

    socket.onmessage = (event: MessageEvent) => {
      localTerminal.write(event.data as string);
    };

    socket.onclose = () => {
      localTerminal.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
      ws = null;
    };
  }

  function handleLocalData(data: string) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(data);
  }

  function handleLocalResize(cols: number, rows: number) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(`\x1b[RESIZE:${cols};${rows}]`);
    }
  }
</script>

<div class="flex min-h-screen flex-col gap-6 p-6">
  <header class="flex items-center justify-between px-2">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">
      {title}
    </h1>
    <div class="flex items-center gap-3">
      <label class="text-sm text-muted-foreground" for="theme-select">
        Theme
      </label>
      <select
        id="theme-select"
        bind:value={themeLabel}
        class="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {#each THEMES as item (item.value)}
          <option value={item.value}>{item.value}</option>
        {/each}
      </select>
    </div>
  </header>
  <main class="flex flex-1 flex-col items-center gap-8">
    <section class="flex w-full max-w-225 flex-col gap-2">
      <h2 class="px-2 text-sm font-medium text-muted-foreground">
        In-browser bash (just-bash)
      </h2>
      <Terminal
        bind:this={bashTerminal}
        cols={80}
        rows={24}
        wasmUrl="/wterm.wasm"
        {theme}
        autoResize
        onData={handleBashData}
        onTitle={handleTitle}
        onReady={handleBashReady}
      />
    </section>
    <section class="flex w-full max-w-225 flex-col gap-2">
      <h2 class="px-2 text-sm font-medium text-muted-foreground">
        Local shell (node-pty over WebSocket)
      </h2>
      <Terminal
        bind:this={localTerminal}
        cols={80}
        rows={24}
        wasmUrl="/wterm.wasm"
        {theme}
        class="w-full"
        onData={handleLocalData}
        onResize={handleLocalResize}
        onReady={handleLocalReady}
      />
    </section>
  </main>
</div>
