<script setup lang="ts">
import { ref, computed, shallowRef, useTemplateRef } from "vue";
import { Terminal } from "@wterm/vue";
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

const bashTerminalRef = useTemplateRef("bashTerminalRef")
const localTerminalRef = useTemplateRef("localTerminalRef")
const themeLabel = ref("Default");
const title = ref("wterm");
const shell = shallowRef<BashShell | null>(null);
const ws = shallowRef<WebSocket | null>(null);

const theme = computed(
  () => THEMES.find((t) => t.value === themeLabel.value)?.theme,
);

function handleBashReady() {
  if (shell.value) return;
  const s = new BashShell({
    files: INITIAL_FILES,
    greeting: [
      "wterm — terminal emulator for the web",
      "Powered by just-bash · running entirely in the browser",
      "",
      "Type help for commands, or try: ls, cat README.md, bash examples/hello.sh",
      "",
    ],
  });
  shell.value = s;
  s.attach((data) => bashTerminalRef.value?.write(data));
}

function handleBashData(data: string) {
  shell.value?.handleInput(data);
}

function handleTitle(newTitle: string) {
  title.value = newTitle;
}

function handleLocalReady() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${window.location.host}/api/terminal`);
  ws.value = socket;

  socket.onmessage = (event: MessageEvent) => {
    localTerminalRef.value?.write(event.data as string);
  };

  socket.onclose = () => {
    localTerminalRef.value?.write(
      "\r\n\x1b[90m[session ended]\x1b[0m\r\n",
    );
    ws.value = null;
  };
}

function handleLocalData(data: string) {
  const socket = ws.value;
  if (socket?.readyState === WebSocket.OPEN) socket.send(data);
}

function handleLocalResize(cols: number, rows: number) {
  const socket = ws.value;
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(`\x1b[RESIZE:${cols};${rows}]`);
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col gap-6 p-6">
    <header class="flex items-center justify-between px-2">
      <h1 class="text-xl font-semibold tracking-tight text-foreground">
        {{ title }}
      </h1>
      <div class="flex items-center gap-3">
        <label class="text-sm text-muted-foreground" for="theme-select">
          Theme
        </label>
        <select id="theme-select" v-model="themeLabel"
          class="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring">
          <option v-for="t in THEMES" :key="t.value" :value="t.value">
            {{ t.value }}
          </option>
        </select>
      </div>
    </header>
    <main class="flex flex-1 flex-col items-center gap-8">
      <section class="flex w-full max-w-225 flex-col gap-2">
        <h2 class="text-sm font-medium text-muted-foreground px-2">
          In-browser bash (just-bash)
        </h2>
        <Terminal ref="bashTerminalRef" :cols="80" :rows="24" wasm-url="/wterm.wasm" :theme auto-resize
          @data="handleBashData" @title="handleTitle" @ready="handleBashReady" />
      </section>
      <section class="flex w-full max-w-225 flex-col gap-2">
        <h2 class="text-sm font-medium text-muted-foreground px-2">
          Local shell (node-pty over WebSocket)
        </h2>
        <Terminal ref="localTerminalRef" :cols="80" :rows="24" wasm-url="/wterm.wasm" :theme class="w-full"
          @data="handleLocalData" @resize="handleLocalResize" @ready="handleLocalReady" />
      </section>
    </main>
  </div>
</template>
