import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

/**
 * Scratch harness for issue #91. Two GhosttyCore terminals side by side, one
 * on the wasm from origin/main (get_scrollback_line is a stub) and one on the
 * rebuilt wasm. Both get byte-identical input, so any difference is the fix.
 */
type Pane = {
  term: WTerm;
  core: GhosttyCore;
  stat: HTMLElement;
};

async function makePane(id: string, wasmPath: string): Promise<Pane> {
  const core = await GhosttyCore.load({ wasmPath });
  const term = new WTerm(document.getElementById(`term-${id}`)!, { core });
  await term.init();
  return { term, core, stat: document.getElementById(`stat-${id}`)! };
}

const panes = [
  await makePane("before", "/ghostty-before.wasm"),
  await makePane("after", "/ghostty-after.wasm"),
];

/** Reads back what each core says about the newest scrolled-off row. */
function refresh(): void {
  for (const { core, stat } of panes) {
    const count = core.getScrollbackCount();
    const len = core.getScrollbackLineLen(0);
    let text = "";
    for (let col = 0; col < len; col++) {
      text += String.fromCodePoint(core.getScrollbackCell(0, col).char || 32);
    }
    text = text.trimEnd();
    stat.textContent = `count ${count} · len(0) ${len} · row(0) ${
      text ? JSON.stringify(text) : "(blank)"
    }`;
  }
}

function writeBoth(data: string): void {
  for (const { term } of panes) term.write(data);
  // The write is async through the terminal; read back on the next frame.
  requestAnimationFrame(() => requestAnimationFrame(refresh));
}

let written = 0;

function writeLines(n: number): void {
  let out = "";
  for (let i = 0; i < n; i++) out += `line-${++written}\r\n`;
  writeBoth(out);
}

function writeColored(): void {
  let out = "";
  for (let i = 0; i < 24; i++) {
    const fg = 31 + (i % 6);
    out += `\x1b[${fg}mcolored-${++written}\x1b[0m  \x1b[1mbold\x1b[0m \x1b[4munderline\x1b[0m\r\n`;
  }
  writeBoth(out);
}

for (const button of document.querySelectorAll("button")) {
  button.addEventListener("click", () => {
    const lines = button.dataset.lines;
    if (lines) return writeLines(Number(lines));
    if (button.dataset.colored) return writeColored();
    written = 0;
    writeBoth("\x1bc");
  });
}

writeBoth(
  "\x1b[1;36mwterm\x1b[0m + libghostty — scrollback comparison\r\n" +
    "Write some lines, then scroll up over each pane.\r\n\r\n",
);
writeLines(200);
