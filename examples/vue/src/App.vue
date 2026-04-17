<script setup lang="ts">
import { BashShell } from "@wterm/just-bash";
import { Terminal, type WTerm } from "@wterm/vue";
import "@wterm/vue/css";

function attachShell(terminal: WTerm) {
  const shell = new BashShell({
    files: {
      "/home/user/README.md":
        "# wterm Vue Example\n\nThis terminal is running inside a Vue 3 component.\n",
      "/home/user/hello.sh": '#!/bin/bash\necho "Hello from the Vue 3 example!"\n',
    },
    greeting: "Welcome to wterm Vue! Type 'help' to get started.",
  });

  shell.attach(terminal.write.bind(terminal));
  terminal.onData = (data: string) => shell.handleInput(data);
}
</script>

<template>
  <main class="app-shell">
    <Terminal
      class="terminal"
      theme="monokai"
      :auto-resize="true"
      :on-ready="attachShell"
    />
  </main>
</template>

<style>
html,
body,
#app {
  margin: 0;
  min-height: 100%;
}

body {
  background: #0f172a;
}

.app-shell {
  min-height: 100vh;
  padding: 24px;
  box-sizing: border-box;
}

.terminal {
  height: calc(100vh - 48px);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.45);
}
</style>
