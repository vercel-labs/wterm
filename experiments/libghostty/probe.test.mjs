import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cpus, release } from "node:os";
import { after, test } from "node:test";
import { PublicApi } from "./public-api.mjs";

const bytes = await readFile(new URL("dist/ghostty-vt.wasm", import.meta.url));
const build = JSON.parse(
  await readFile(new URL("dist/build.json", import.meta.url)),
);
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  build.artifact.sha256,
);
const api = await PublicApi.load(bytes);
const checks = [];
function probe(name, fn) {
  test(name, async (context) => {
    const result = { name, passed: false };
    checks.push(result);
    await fn(context, result);
    result.passed = true;
  });
}
function terminal(context, cols = 20, rows = 4) {
  const value = api.terminal(cols, rows);
  context.after(() => value.dispose());
  return value;
}
const rgb = (r, g, b) => ({ r, g, b });

probe(
  "public render state preserves fragmented graphemes, style, and cursor",
  (context, result) => {
    const term = terminal(context);
    const input = new TextEncoder().encode(
      "\x1b[?2027h\x1b[1;3;4:3;38:2::12:34:56;58:2::90:80:70me\u0301界👩‍💻\x1b[0m\x1b[6 q",
    );
    for (const byte of input) term.write(Uint8Array.of(byte));
    const frame = term.render();
    assert.equal(frame.grid[0].text, "e\u0301界👩‍💻");
    assert.deepEqual(
      frame.grid[0].cells.slice(0, 5).map(({ width }) => width),
      [1, 2, 0, 2, 0],
    );
    const style = frame.grid[0].cells[0].style;
    assert.equal(style.bold, true);
    assert.equal(style.italic, true);
    assert.equal(style.underline, api.enum("GhosttySgrUnderline", "CURLY"));
    assert.deepEqual(style.fg_color.value.rgb, rgb(12, 34, 56));
    assert.deepEqual(style.underline_color.value.rgb, rgb(90, 80, 70));
    assert.equal(frame.cursor.viewport_x, 5);
    assert.equal(
      frame.cursor.visual_style,
      api.enum("GhosttyRenderStateCursorVisualStyle", "BAR"),
    );
    assert.equal(frame.cursor.blinking, false);
    result.cell = frame.grid[0].cells[0];
    result.cursor = frame.cursor;
  },
);

probe(
  "public dirty state identifies a changed row and survives memory growth",
  (context) => {
    const term = terminal(context);
    term.write("one\r\ntwo");
    term.render();
    term.clean();
    assert.equal(
      term.render().dirty,
      api.enum("GhosttyRenderStateDirty", "FALSE"),
    );
    api.exports.memory.grow(1);
    term.write("\x1b[2;1HX");
    const frame = term.render();
    assert.equal(frame.dirty, api.enum("GhosttyRenderStateDirty", "PARTIAL"));
    assert.deepEqual(
      frame.grid.flatMap((row, i) => (row.dirty ? [i] : [])),
      [1],
    );
    assert.equal(frame.grid[1].text, "Xwo");
  },
);

probe(
  "JavaScript receives replies, title, cwd, and bell effects",
  (context, result) => {
    const term = terminal(context);
    term.write(
      "ABC\x1b[6n\x07\x1b]2;public API\x1b\\\x1b]7;file:///tmp/wterm\x1b\\",
    );
    assert.deepEqual(term.effects, [
      { type: "reply", data: "\x1b[1;4R" },
      { type: "bell" },
      { type: "title" },
      { type: "pwd" },
    ]);
    assert.equal(api.string(term.get("TITLE", "GhosttyString")), "public API");
    assert.equal(
      api.string(term.get("PWD", "GhosttyString")),
      "file:///tmp/wterm",
    );
    term.resize(40, 8);
    assert.deepEqual(
      [
        term.get("COLS", "u16"),
        term.get("ROWS", "u16"),
        term.get("WIDTH_PX", "u32"),
      ],
      [40, 8, 320],
    );
    result.effects = term.effects;
  },
);

probe(
  "history search and tracked positions survive scrolling and reflow",
  (context, result) => {
    const term = terminal(context, 20, 4);
    term.set("SCROLLBACK_MAX_BYTES", "u64", 1024n * 1024n);
    term.write("prefix needle 界\r\n");
    const anchor = term.track(14, 0);
    for (let i = 0; i < 8; i++) term.write(`line ${i}\r\n`);
    term.write("needle");
    assert.equal(term.gridText("HISTORY", 14, 0), "界");
    assert.equal(anchor.valid(), true);
    assert.deepEqual(anchor.point("HISTORY"), { x: 14, y: 0 });
    term.resize(10, 4);
    assert.equal(anchor.valid(), true);
    assert.deepEqual(anchor.point("HISTORY"), { x: 4, y: 1 });
    assert.equal(term.gridText("HISTORY", 4, 1), "界");
    const search = term.search("NEEDLE");
    assert.equal(search.status, api.enum("GhosttySearchStatus", "COMPLETE"));
    assert.equal(search.count, 2);
    result.matches = search.count;
  },
);

probe(
  "snapshots restore both screens, history, modes, and an unfinished CSI",
  (context, result) => {
    const term = terminal(context, 20, 4);
    term.write(
      "history\r\n1\r\n2\r\n3\r\nprimary\x1b[?2004h\x1b[?1049h\x1b[Halt\x1b[38;2;12;",
    );
    assert.equal(term.get("VT_GROUND", "bool"), false);
    const snapshot = term.snapshot();
    const restored = api.restore(snapshot);
    context.after(() => restored.dispose());
    // A restored non-ground terminal can be snapshotted again before more input.
    const restoredAgain = api.restore(restored.snapshot());
    context.after(() => restoredAgain.dispose());
    for (const candidate of [term, restoredAgain]) {
      candidate.write("34;56mZ");
      assert.equal(candidate.render().grid[0].text, "altZ");
      assert.deepEqual(
        candidate.render().grid[0].cells[3].style.fg_color.value.rgb,
        rgb(12, 34, 56),
      );
      assert.equal(candidate.mode(2004), true);
      candidate.write("\x1b[?1049l");
      assert.equal(candidate.render().grid[3].text, "primary");
      assert.equal(candidate.gridText("HISTORY", 0, 0), "h");
    }
    assert.deepEqual(restoredAgain.render(), term.render());
    assert.throws(
      () => api.restore(snapshot.subarray(0, snapshot.length - 1)),
      { code: api.enum("GhosttyResult", "INVALID_VALUE") },
    );
    const corrupted = snapshot.slice();
    corrupted[30] ^= 1;
    assert.throws(() => api.restore(corrupted), {
      code: api.enum("GhosttyResult", "INVALID_VALUE"),
    });
    result.bytes = snapshot.length;
  },
);

probe(
  "snapshots preserve partial UTF-8 and reject untracked continuation",
  (context) => {
    const term = terminal(context);
    term.write(Uint8Array.of(0xe7, 0x95));
    const restored = api.restore(term.snapshot());
    context.after(() => restored.dispose());
    restored.write(Uint8Array.of(0x8c));
    assert.equal(restored.render().grid[0].text, "界");
    const untracked = terminal(context);
    untracked.set("CONTINUATION_MAX_BYTES", "u32", 0);
    untracked.write("\x1b[38;");
    assert.throws(() => untracked.snapshot(), {
      code: api.enum("GhosttyResult", "INVALID_VALUE"),
    });
  },
);

probe(
  "the upstream freestanding build does not provide Kitty graphics",
  (context, result) => {
    const term = terminal(context);
    const supported = api.withMemory(1, (out) => {
      api.check(
        api.exports.ghostty_build_info(
          api.enum("GhosttyBuildInfo", "KITTY_GRAPHICS"),
          out,
        ),
        "build info",
      );
      return api.read("bool", out);
    });
    assert.equal(supported, false);
    term.set("KITTY_IMAGE_STORAGE_LIMIT", "u64", 32n * 1024n * 1024n);
    assert.throws(() => term.get("KITTY_GRAPHICS", "pointer"), {
      code: api.enum("GhosttyResult", "NO_VALUE"),
    });
    assert.throws(() => term.get("KITTY_IMAGE_STORAGE_LIMIT", "u64"), {
      code: api.enum("GhosttyResult", "NO_VALUE"),
    });
    result.supported = supported;
  },
);

for (const id of ["neovim-edit", "tmux-pane"]) {
  const fixture = JSON.parse(
    await readFile(new URL(`../../e2e/fixtures/${id}.json`, import.meta.url)),
  );
  probe(`public API replays ${id} checkpoints`, (context, result) => {
    const term = terminal(context, fixture.cols, fixture.rows);
    const checkpoints = [];
    for (const event of fixture.events) {
      if (event.type === "output") {
        const data = Buffer.from(event.data, "base64");
        for (let i = 0; i < data.length; i += 7)
          term.write(data.subarray(i, i + 7));
      } else if (event.type === "resize") term.resize(event.cols, event.rows);
      else if (event.type === "checkpoint") {
        const frame = term.render();
        const expected = event.expected;
        for (const [row, text] of Object.entries(expected.rows ?? {}))
          assert.equal(frame.grid[row].text, text, event.name);
        if (expected.cols) assert.equal(frame.cols, expected.cols);
        if (expected.height) assert.equal(frame.rows, expected.height);
        if (expected.cursor?.row !== undefined)
          assert.equal(frame.cursor.viewport_y, expected.cursor.row);
        if (expected.cursor?.col !== undefined)
          assert.equal(frame.cursor.viewport_x, expected.cursor.col);
        if (expected.modes?.alternateScreen !== undefined)
          assert.equal(
            term.get("ACTIVE_SCREEN", "i32") ===
              api.enum("GhosttyTerminalScreen", "ALTERNATE"),
            expected.modes.alternateScreen,
          );
        for (const { row, col, value } of expected.cells ?? []) {
          if (value.char !== undefined)
            assert.equal(
              frame.grid[row].cells[col].text.codePointAt(0),
              value.char,
            );
          if (value.width !== undefined)
            assert.equal(frame.grid[row].cells[col].width, value.width);
        }
        checkpoints.push(event.name);
      }
    }
    result.checkpoints = checkpoints;
    result.fixtureSha256 = createHash("sha256")
      .update(JSON.stringify(fixture))
      .digest("hex");
  });
}

probe("terminal disposal releases callback slots for reuse", () => {
  api.terminal(10, 2).dispose();
  const initial = api.exports.__indirect_function_table.length;
  for (let i = 0; i < 20; i++) {
    const term = api.terminal(10, 2);
    term.write("\x07");
    assert.deepEqual(term.effects, [{ type: "bell" }]);
    term.dispose();
    term.dispose();
  }
  assert.equal(api.exports.__indirect_function_table.length, initial);
});

after(async () => {
  await writeFile(
    new URL("dist/probe.json", import.meta.url),
    JSON.stringify(
      {
        ...build,
        environment: {
          platform: process.platform,
          arch: process.arch,
          osRelease: release(),
          node: process.version,
          cpu: cpus()[0]?.model,
        },
        instantiateMs: api.instantiateMs,
        memoryBytes: api.exports.memory.buffer.byteLength,
        checks,
      },
      null,
      2,
    ) + "\n",
  );
});
