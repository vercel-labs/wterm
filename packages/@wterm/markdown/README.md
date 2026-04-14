# @wterm/markdown

Streaming markdown-to-ANSI renderer for [wterm](https://github.com/vercel-labs/wterm) terminals. Converts Markdown to terminal escape sequences as text arrives, making it ideal for LLM streaming output.

## Install

```bash
npm install @wterm/markdown
```

## Usage

```ts
import { MarkdownRenderer } from "@wterm/markdown";

const renderer = new MarkdownRenderer({ width: 80 });

// Feed chunks as they arrive (e.g. from an LLM stream)
const ansi = renderer.push("# Hello\n\nThis is **bold** and `code`.\n");
terminal.write(ansi);

// Flush remaining content when the stream ends
terminal.write(renderer.flush());
```

## API

### `MarkdownRenderer`

```ts
new MarkdownRenderer(options?: { width?: number })
```

| Method | Description |
|---|---|
| `push(delta: string): string` | Feed a chunk of Markdown text; returns rendered ANSI output |
| `flush(): string` | Flush any remaining buffered content |

### Supported Markdown

- Headings (`#` through `######`)
- Bold (`**text**`), italic (`*text*`), inline code (`` `code` ``)
- Links (`[text](url)`)
- Unordered and ordered lists
- Code blocks (fenced with `` ``` ``)
- Blockquotes (`> text`)
- Horizontal rules (`---`)

## License

Apache-2.0
