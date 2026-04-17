<script setup lang="ts">
import { ref, computed, shallowRef } from "vue";
import { Terminal, type TerminalHandle } from "@wterm/vue";
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

const terminalRef = ref<TerminalHandle | null>(null);
const themeLabel = ref("Default");
const title = ref("wterm");
const shell = shallowRef<BashShell | null>(null);

const theme = computed(
  () => THEMES.find((t) => t.value === themeLabel.value)?.theme,
);

function handleReady() {
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
  s.attach((data) => terminalRef.value?.write(data));
}

function handleData(data: string) {
  shell.value?.handleInput(data);
}

function handleTitle(newTitle: string) {
  title.value = newTitle;
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
        <select
          id="theme-select"
          v-model="themeLabel"
          class="h-9 w-[160px] rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option v-for="t in THEMES" :key="t.value" :value="t.value">
            {{ t.value }}
          </option>
        </select>
      </div>
    </header>
    <main class="flex flex-1 items-start justify-center">
      <Terminal
        ref="terminalRef"
        :cols="80"
        :rows="24"
        wasm-url="/wterm.wasm"
        :theme="theme"
        class="w-full max-w-[900px]"
        @data="handleData"
        @title="handleTitle"
        @ready="handleReady"
      />
    </main>
  </div>
</template>
