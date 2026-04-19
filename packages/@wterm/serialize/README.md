# @wterm/serialize

Serialize and restore terminal state for [wterm](https://github.com/vercel-labs/wterm). Capture a snapshot of the current grid + scrollback and restore it later for session persistence.

## Install

```bash
npm install @wterm/serialize
```

## Quick Start

```ts
import { WTerm } from "@wterm/dom";
import { serialize, restore } from "@wterm/serialize";
import "@wterm/dom/css";

const term = new WTerm(document.getElementById("terminal")!);
await term.init();

const saved = localStorage.getItem("terminal:snapshot");
if (saved) {
  restore(term, JSON.parse(saved));
}

window.addEventListener("beforeunload", () => {
  const snapshot = serialize(term);
  localStorage.setItem("terminal:snapshot", JSON.stringify(snapshot));
});
```

## API

### `TerminalSnapshot`

```ts
interface TerminalSnapshot {
  version: 1;
  cols: number;
  rows: number;
  payload: string;
  cursor: { row: number; col: number; visible: boolean };
  modes: {
    altScreen: boolean;
    cursorKeysApp: boolean;
    bracketedPaste: boolean;
  };
}
```

### Functions

```ts
serialize(term: WTerm): TerminalSnapshot
restore(term: WTerm, snapshot: TerminalSnapshot): void
```

## Limitations

- Partial parser state in the middle of an escape sequence is not captured.
- Terminal title state is not captured in v1.

## License

Apache-2.0
