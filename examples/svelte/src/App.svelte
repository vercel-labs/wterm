<script lang="ts">
  import { BashShell } from "@wterm/just-bash";
  import { wterm, type WTerm } from "@wterm/svelte";
  import "@wterm/svelte/css";

  function attachShell(terminal: WTerm) {
    const shell = new BashShell({
      files: {
        "/home/user/README.md":
          `# wterm Svelte Example

This terminal is running inside a Svelte app.
`,
        "/home/user/hello.sh": `#!/bin/bash
echo "Hello from the Svelte example!"
`,
      },
      greeting: "Welcome to wterm Svelte! Type 'help' to get started.",
    });

    shell.attach(terminal.write.bind(terminal));
    terminal.onData = (data: string) => shell.handleInput(data);
  }
</script>

<svelte:head>
  <title>wterm — Svelte Example</title>
</svelte:head>

<div class="app-shell">
  <div
    class="terminal"
    use:wterm={{ autoResize: true, theme: "monokai", onReady: attachShell }}
  ></div>
</div>

<style>
  :global(html),
  :global(body),
  :global(#app) {
    margin: 0;
    min-height: 100%;
  }

  :global(body) {
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
