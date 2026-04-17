import { useCallback, useRef } from "react";
import { BashShell } from "@wterm/just-bash";
import { Terminal, useTerminal, type WTerm } from "@wterm/react";
import "@wterm/react/css";

export default function App() {
  const { ref, write } = useTerminal();
  const shellRef = useRef<BashShell | null>(null);

  const handleData = useCallback((data: string) => {
    shellRef.current?.handleInput(data);
  }, []);

  const handleReady = useCallback(
    (_terminal: WTerm) => {
      if (shellRef.current) {
        return;
      }

      const shell = new BashShell({
        files: {
          "/home/user/README.md":
            `# wterm React + Vite Example

This terminal is running inside a React app powered by Vite.
`,
          "/home/user/hello.sh": `#!/bin/bash
echo "Hello from the React + Vite example!"
`,
        },
        greeting: "Welcome to wterm React! Type 'help' to get started.",
      });

      shell.attach(write);
      shellRef.current = shell;
    },
    [write],
  );

  return (
    <main className="app-shell">
      <Terminal
        ref={ref}
        className="terminal"
        theme="monokai"
        autoResize
        onData={handleData}
        onReady={handleReady}
      />
    </main>
  );
}
