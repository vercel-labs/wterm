# @wterm/just-bash

Shell adapter for [wterm](https://github.com/vercel-labs/wterm), powered by [just-bash](https://github.com/vercel-labs/just-bash). Provides line editing, tab completion, command history, and a colored prompt — all running in the browser with no backend.

## Install

```bash
npm install @wterm/just-bash just-bash
```

`just-bash` is a peer dependency.

## Usage

```tsx
import { useCallback, useRef } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import { BashShell } from "@wterm/just-bash";
import "@wterm/react/css";

function App() {
  const { ref, write } = useTerminal();
  const shellRef = useRef<BashShell | null>(null);

  const handleReady = useCallback(() => {
    if (shellRef.current) return;
    const shell = new BashShell({
      files: { "/home/user/hello.txt": "Hello, world!\n" },
      greeting: "Welcome to wterm!",
    });
    shellRef.current = shell;
    shell.attach(write);
  }, [write]);

  const handleData = useCallback((data: string) => {
    shellRef.current?.handleInput(data);
  }, []);

  return (
    <Terminal
      ref={ref}
      onReady={handleReady}
      onData={handleData}
    />
  );
}
```

## API

### `BashShell`

```ts
new BashShell(options?: ShellOptions)
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `files` | `Record<string, string>` | `{}` | Virtual filesystem |
| `env` | `Record<string, string>` | `{ SHELL, TERM }` | Environment variables |
| `cwd` | `string` | `"/home/user"` | Initial working directory |
| `greeting` | `string \| string[]` | — | Greeting printed on attach |
| `prompt` | `(cwd: string) => string` | colored `user@wterm:~$` | Custom prompt function |
| `network` | `NetworkConfig` | — | Network access configuration |

**Methods:**

| Method | Description |
|---|---|
| `attach(write): Promise<void>` | Connect to a terminal write function |
| `handleInput(data): Promise<void>` | Process terminal input (keystrokes) |

**Properties:**

| Property | Type | Description |
|---|---|---|
| `cwd` | `string` | Current working directory |
| `bash` | `Bash \| null` | Underlying just-bash instance |

### Features

- Line editing with backspace
- Command history (up/down arrows)
- Tab completion (files + commands)
- Ctrl+C to cancel, Ctrl+L to clear
- Directory-aware prompt updates

## License

Apache-2.0
