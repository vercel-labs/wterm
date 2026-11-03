import { WTerm } from "@wterm/dom";
import "@wterm/dom/css";
import "./styles.css";
import type { ClientEvent, CommandMeta, ToolKind, UiEvent } from "./protocol";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const transcript = $("transcript");
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Follow the newest output unless the reader scrolled the page up.
let followPage = true;
addEventListener("scroll", () => {
  followPage =
    innerHeight + scrollY >= document.documentElement.scrollHeight - 48;
});
let scrollQueued = false;
function keepPageAtBottom() {
  if (!followPage || scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    scrollTo({ top: document.documentElement.scrollHeight });
  });
}

// ---------- tool cards ----------

const MAX_ROWS = 18;
const PADDING_PX = 20;
/** Replaced by wterm's measured row height once a terminal starts. */
let rowPx = 17;
// The built-in core keeps 1,000 scrollback lines plus the grid, so a terminal
// that is mounted again never needs more than this.
const KEEP_LINES = 1000 + MAX_ROWS;

type Card = {
  root: HTMLElement;
  status: HTMLElement;
  tip: HTMLElement;
  host: HTMLElement;
  term?: WTerm;
  mount: "none" | "loading" | "ready" | "failed";
  visible: boolean;
  done: boolean;
  /** Output not yet written to the terminal. */
  pending: string;
  heldNewline: boolean;
  /** All output, trimmed to KEEP_LINES, for mounting the terminal again. */
  log: string;
  logLines: number;
  lines: number;
  openLine: boolean;
  rows: number;
};
const cards = new Map<string, Card>();

// Terminals start when a card first scrolls into view and are destroyed when a
// finished card leaves it. Each built-in core is a separate WebAssembly
// instance, and a page can only hold about a hundred of them at once.
const visibility = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const card = cards.get((entry.target as HTMLElement).dataset.id ?? "");
      if (!card) continue;
      card.visible = entry.isIntersecting;
      if (!card.visible && card.done) {
        unmount(card);
        continue;
      }
      card.term?.setRenderingPaused(!card.visible);
      if (card.visible && card.mount === "none") {
        requestAnimationFrame(() => {
          if (card.visible && card.mount === "none") mount(card);
        });
      }
    }
  },
  { rootMargin: "200px 0px" },
);

// One write per terminal per frame, however many chunks arrived.
const dirty = new Set<Card>();
let flushQueued = false;
function scheduleFlush() {
  if (flushQueued) return;
  flushQueued = true;
  requestAnimationFrame(flush);
}
function flush() {
  flushQueued = false;
  for (const card of dirty) {
    if (!card.term || !card.pending) continue;
    let data = card.pending;
    card.pending = "";
    // Hold back a trailing newline until more output arrives, so a finished
    // card ends on its last line instead of an empty cursor row.
    if (card.heldNewline) data = `\r\n${data}`;
    card.heldNewline = data.endsWith("\r\n");
    if (card.heldNewline) data = data.slice(0, -2);
    if (data) card.term.write(data);
  }
  dirty.clear();
  keepPageAtBottom();
}

function writeOutput(card: Card, data: string) {
  // Size the card to its output, up to MAX_ROWS, before the terminal exists.
  for (let i = data.indexOf("\n"); i >= 0; i = data.indexOf("\n", i + 1)) {
    card.lines++;
    card.logLines++;
  }
  if (data) card.openLine = !data.endsWith("\n");
  const rows = Math.min(
    MAX_ROWS,
    Math.max(1, card.lines + (card.openLine ? 1 : 0)),
  );
  if (rows !== card.rows) {
    card.rows = rows;
    card.host.style.height = `${rows * rowPx + PADDING_PX}px`;
  }
  card.log += data;
  if (card.logLines >= KEEP_LINES * 2) {
    let cut = card.log.length;
    for (let n = 0; n < KEEP_LINES && cut > 0; n++)
      cut = card.log.lastIndexOf("\n", cut - 1);
    card.log = card.log.slice(cut + 1);
    card.logLines = KEEP_LINES;
  }
  card.pending += data;
  dirty.add(card);
  scheduleFlush();
}

async function mount(card: Card) {
  card.mount = "loading";
  try {
    const term = new WTerm(card.host, { autoResize: true });
    await term.init();
    // wterm publishes its measured row height on the host element.
    const measured = parseFloat(
      card.host.style.getPropertyValue("--term-row-height"),
    );
    if (measured > 0) rowPx = measured;
    card.host.style.height = `${card.rows * rowPx + PADDING_PX}px`;
    term.write("\x1b[?25l"); // Output only: no cursor.
    card.term = term;
    card.mount = "ready";
    card.pending = card.log;
    card.heldNewline = false;
    if (!card.visible) {
      if (card.done) return unmount(card);
      term.setRenderingPaused(true);
    }
    dirty.add(card);
    scheduleFlush();
  } catch (error) {
    card.mount = "failed";
    const plain = card.log.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\r/g, "");
    card.host.replaceChildren(el("pre", "fallback", plain));
    card.host.title = String(error);
  }
}

function unmount(card: Card) {
  if (card.mount !== "ready" || !card.term) return;
  card.term.destroy();
  card.term = undefined;
  card.host.replaceChildren();
  card.host.className = "term-host";
  card.pending = "";
  card.heldNewline = false;
  card.mount = "none";
  dirty.delete(card);
}

const KIND_LABEL: Record<ToolKind, string> = {
  execute: "run",
  read: "read",
  edit: "edit",
  other: "tool",
};

function createCard(event: Extract<UiEvent, { type: "tool" }>) {
  const root = el("section", `card kind-${event.kind}`);
  root.dataset.id = event.id;
  const head = el("div", "card-head");
  head.tabIndex = 0;
  const status = el("span", "status pending", "running");
  const tip = el("div", "tip");
  tip.setAttribute("role", "tooltip");
  tip.append(definitionList([["tool", event.name], ...inputRows(event.input)]));
  head.append(
    el("span", "badge", KIND_LABEL[event.kind]),
    el("code", "summary", event.summary || event.title),
    status,
    tip,
  );
  const host = el("div", "term-host");
  host.style.height = `${rowPx + PADDING_PX}px`;
  root.append(head, host);
  transcript.append(root);
  cards.set(event.id, {
    root,
    status,
    tip,
    host,
    mount: "none",
    visible: false,
    done: false,
    pending: "",
    heldNewline: false,
    log: "",
    logLines: 0,
    lines: 0,
    openLine: false,
    rows: 1,
  });
  if (event.kind !== "read") visibility.observe(root);
}

function definitionList(rows: [string, string][]) {
  const list = el("dl");
  for (const [key, value] of rows) {
    if (value)
      list.append(el("dt", undefined, key), el("dd", undefined, value));
  }
  return list;
}

function inputRows(input: Record<string, unknown>): [string, string][] {
  return Object.entries(input)
    .filter(([key]) => key !== "old_string" && key !== "new_string")
    .map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]);
}

function metaRows(meta: CommandMeta): [string, string][] {
  return [
    ["exit", meta.exitCode == null ? "" : String(meta.exitCode)],
    ["time", meta.durationMs === undefined ? "" : `${meta.durationMs} ms`],
  ];
}

// ---------- messages ----------

const textNodes = new Map<string, Text>();

function appendText(id: string, text: string, kind: "message" | "thought") {
  let node = textNodes.get(id);
  if (!node) {
    node = document.createTextNode("");
    if (kind === "thought") {
      const details = el("details", "thought");
      const body = el("div", "thought-body");
      body.append(node);
      details.append(el("summary", undefined, "Thinking"), body);
      transcript.append(details);
    } else {
      const block = el("div", "message");
      block.append(node);
      transcript.append(block);
    }
    textNodes.set(id, node);
  }
  node.data += text;
  keepPageAtBottom();
}

// ---------- events ----------

function handle(event: UiEvent) {
  switch (event.type) {
    case "session":
      $("agent").textContent = event.agent;
      $("agent").title = event.ansi
        ? "Command output keeps its colors"
        : "This agent sends command output as plain text";
      $<HTMLButtonElement>("send").disabled = false;
      break;
    case "user":
      transcript.append(el("div", "user", event.text));
      break;
    case "message":
    case "thought":
      appendText(event.id, event.text, event.type);
      break;
    case "tool":
      createCard(event);
      break;
    case "output": {
      const card = cards.get(event.id);
      if (card) writeOutput(card, event.data);
      break;
    }
    case "done": {
      const card = cards.get(event.id);
      if (!card) break;
      card.done = true;
      if (!card.log) card.root.classList.add("empty");
      if (!card.visible) unmount(card);
      const exit = event.meta?.exitCode;
      card.status.className = `status ${event.status}`;
      card.status.textContent =
        event.status === "failed"
          ? exit == null
            ? "failed"
            : `exit ${exit}`
          : event.meta?.durationMs === undefined
            ? "done"
            : `${event.meta.durationMs} ms`;
      if (event.meta) card.tip.append(definitionList(metaRows(event.meta)));
      break;
    }
    case "permission": {
      const box = el("div", "permission");
      box.append(el("span", undefined, event.title));
      for (const option of event.options) {
        const button = el("button", `option ${option.kind}`, option.name);
        button.onclick = () => {
          send({
            type: "permission",
            requestId: event.requestId,
            optionId: option.optionId,
          });
          box.remove();
        };
        box.append(button);
      }
      const card = event.toolId ? cards.get(event.toolId) : undefined;
      (card?.root ?? transcript).append(box);
      break;
    }
    case "title":
      $("title").textContent = event.text;
      document.title = event.text;
      break;
    case "turn":
      setBusy(false);
      break;
    case "error":
      transcript.append(el("div", "error", event.text));
      break;
  }
}

const socket = new WebSocket(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
);
const send = (event: ClientEvent) => socket.send(JSON.stringify(event));
socket.onmessage = (message) => {
  for (const event of JSON.parse(message.data) as UiEvent[]) handle(event);
};

// ---------- composer ----------

const form = $<HTMLFormElement>("composer");
const prompt = $<HTMLTextAreaElement>("prompt");
function setBusy(busy: boolean) {
  $<HTMLButtonElement>("send").disabled = busy;
}
form.onsubmit = (event) => {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!text) return;
  setBusy(true);
  send({ type: "prompt", text });
  prompt.value = "";
};
prompt.onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
};
