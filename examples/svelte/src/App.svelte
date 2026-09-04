<script lang="ts">
  import { BashShell } from "@wterm/just-bash";
  import {
    Terminal,
    type TerminalHandle,
    type WTerm,
  } from "@wterm/svelte";
  import "@wterm/svelte/css";

  const themes = [
    { label: "Default", value: undefined },
    { label: "Solarized Dark", value: "solarized-dark" },
    { label: "Monokai", value: "monokai" },
    { label: "Light", value: "light" },
  ];

  const files: Record<string, string> = {
    "/home/user/README.md":
      "# wterm\n\nA terminal emulator for the web, powered by Svelte and WebAssembly.\n",
    "/home/user/hello.sh":
      '#!/bin/bash\necho "Hello from the Svelte example!"\n',
  };

  let terminal: TerminalHandle | undefined;
  let shell: BashShell | undefined;
  let theme: string | undefined;
  let title = "wterm — Svelte Example";

  function handleReady(wt: WTerm): void {
    if (shell) return;

    const nextShell = new BashShell({
      files,
      greeting: [
        "wterm — Svelte 5 example",
        "Powered by @wterm/svelte and just-bash",
        "",
        "Try: ls, cat README.md, or bash hello.sh",
        "",
      ],
    });

    shell = nextShell;
    nextShell.attach(wt.write.bind(wt));
  }

  function handleData(data: string): void {
    shell?.handleInput(data);
  }

  function handleTitle(nextTitle: string): void {
    title = nextTitle;
    document.title = nextTitle;
  }

  function runCommand(command: string): void {
    shell?.handleInput(`${command}\r`);
  }
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<div class="page">
  <header class="header">
    <div>
      <p class="eyebrow">wterm playground</p>
      <h1>{title}</h1>
    </div>

    <label>
      <span>Theme</span>
      <select bind:value={theme}>
        {#each themes as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
  </header>

  <main>
    <Terminal
      bind:this={terminal}
      {theme}
      cols={88}
      rows={28}
      className="terminal"
      onData={handleData}
      onReady={handleReady}
      onTitle={handleTitle}
    />

    <div class="controls">
      <button type="button" onclick={() => runCommand("help")}>Run help</button>
      <button type="button" onclick={() => runCommand("ls")}>List files</button>
      <button type="button" onclick={() => terminal?.focus()}>Focus terminal</button>
    </div>
  </main>

  <p class="hint">
    Input is handled by <code>@wterm/just-bash</code> in the browser. Select text,
    copy it, or try <code>cat README.md</code>.
  </p>
</div>
