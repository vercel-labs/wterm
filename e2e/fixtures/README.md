# Terminal replay fixtures

`neovim-edit.json` and `tmux-pane.json` contain raw output captured from real PTYs, generated input, resize events, and authored screen checkpoints. The capture metadata includes application version, OS, architecture, locale, TERM, and the complete terminfo entry with its SHA-256 hash. They use generated sample content and isolated app configuration; normal CI does not run either application.

`protocol.ts` contains small authored streams for byte-fragmented Unicode and SGR, wide-character insertion/deletion and right-edge wrapping, alternate-screen restoration, cursor responses, repeated resizing, retained history, and synchronized output. These streams have no capture clock; their `atMs` values are zero. They are not application recordings.

Application capture does not emulate a terminal or send capability responses; applications use TERM/terminfo and their own query fallbacks. During replay, wterm responses are captured in the checkpoint reports, without changing the recorded application's output. The explicit cursor-report fixture asserts an exact reply.

## Format

`types.ts` defines schema version 1. Each fixture specifies initial columns/rows, source metadata, and ordered events:

| Type | Fields | Playback |
| --- | --- | --- |
| `output` | `atMs`, `data` (base64) | Decode exact bytes and write in small chunks |
| `input` | `atMs`, `data` (text) | Provenance only; do not execute |
| `resize` | `atMs`, `cols`, `rows` | Resize the terminal before the next output |
| `checkpoint` | `atMs`, `name`, `expected` | Assert terminal and DOM state after a frame callback |

Times are milliseconds since capture start. Playback preserves ordering and resize boundaries but skips wall-clock delays. Application output is split into chunks of at most seven bytes; protocol output into single bytes. This deliberately splits UTF-8 code points and escape sequences across writes.

Checkpoint row/column indices are zero-based. `rows` are trimmed visible core text and, by default, the expected rendered DOM text. `renderedRows` overrides only the DOM expectation (for example while synchronized output holds a frame). Other assertions cover selected cells, computed styles, cursor, modes, dimensions, replies, and scrollback. `history` contains up to the most recent 100 retained rows in chronological order. Unspecified state is retained in the report but not asserted. Expected text comes from the generated sample files/commands and specified protocol operations, not from a snapshot of the implementation under test.

These are semantic checkpoints, not pixel references captured from Ghostty desktop. Font rasterization, exact desktop color themes, and native presentation latency are outside the measurements.

## Re-recording

From the repository root, with `nvim`, `tmux`, and `infocmp` available:

```bash
pnpm --filter @internal/pty-harness record
pnpm test:pty
```

[`record-apps.mjs`](../harness/record-apps.mjs) creates its own working directory, editor configuration, and tmux server, then removes them on completion. The committed captures were made with Neovim 0.11.1 and tmux 3.6a on macOS; each JSON records the exact environment. Different application versions can emit different sequences, so review refreshed captures and their checkpoints together.

Run `pnpm --filter @internal/pty-harness test:e2e replay.spec.ts --project chromium` after building the workspace to focus on one browser. Per-test replay reports and the combined `baseline.json` are generated under `e2e/test-results/pty/` and uploaded by CI. See the [harness README](../harness/README.md) for measurement definitions.
