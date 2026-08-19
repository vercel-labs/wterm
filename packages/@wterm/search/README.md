# @wterm/search

Grid and scrollback search for [wterm](https://github.com/vercel-labs/wterm) terminals.

## Search

Search across both visible rows and WASM-backed scrollback.

## Install

```bash
npm install @wterm/search
```

## Quick Start

```ts
import { WTerm } from "@wterm/dom";
import { Search } from "@wterm/search";
import "@wterm/dom/css";

const term = new WTerm(document.getElementById("terminal"));
await term.init();

term.write("error: failed to connect\\r\\n");
term.write("warning: retrying\\r\\n");

const search = new Search(term);
const match = search.findNext("error");

if (match) {
  console.log(match.row, match.col, match.text);
}
```

## API

### `SearchOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `caseSensitive` | `boolean` | `false` | Match case exactly |
| `regex` | `boolean` | `false` | Treat `query` as a regular expression |
| `wholeWord` | `boolean` | `false` | Match only whole words |

### `SearchMatch`

| Field | Type | Description |
|---|---|---|
| `row` | `number` | Match row (`-1` is most recent scrollback line, `0+` is grid row) |
| `col` | `number` | Zero-based column of the match |
| `length` | `number` | Match length in characters |
| `text` | `string` | Matched text |

### `Search`

| Method | Description |
|---|---|
| `new Search(term)` | Create a search instance for an initialized `WTerm` |
| `findNext(query, opts?)` | Find the next match after the internal cursor |
| `findPrevious(query, opts?)` | Find the previous match before the internal cursor |
| `findAll(query, opts?)` | Return all matches in oldest-first buffer order |
| `reset()` | Clear the internal cursor |

## Limitations

`@wterm/search` returns match positions and text. Visual highlighting (for example via the CSS Highlight API) is planned as a follow-up PR.

## License

Apache-2.0
