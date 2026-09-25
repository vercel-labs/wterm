# @wterm/just-bash

Shell adapter for [wterm](https://github.com/vercel-labs/wterm), powered by [just-bash](https://github.com/vercel-labs/just-bash). Provides line editing, tab completion, command history, and a colored prompt — all running in the browser with no backend.

## Install

```bash
npm install @wterm/just-bash just-bash
```

`just-bash` 3 is a peer dependency.

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

- Line editing with Backspace, Delete, Home/End, and word-wise cursor movement (Option/Alt+arrows, Ctrl+arrows, Alt+B/F)
- Erase the previous word with Option/Alt+Backspace or Ctrl+W; erase before or after the cursor with Ctrl+U or Ctrl+K
- Ctrl+Y restores the text erased by those shortcuts, including consecutive erasures
- Unicode-aware editing for emoji, combining marks, and wide characters
- Command history (up/down arrows) that restores your unfinished command and cursor position
- Ctrl+R to search command history from newest to oldest; during a search, Ctrl+S moves toward newer matches, Enter runs a match, Escape opens it for editing, and Ctrl+G restores your unfinished command
- Tab completion for files and commands at the cursor, including earlier words in a command
- Ctrl+C to cancel input or interrupt a running command, Ctrl+L to clear the screen
- Each submitted command executes once
- Directory-aware prompt updates after every command, including nonzero exits

## License

Apache-2.0
