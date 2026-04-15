import { WTerm } from "@wterm/dom";
import "@wterm/dom/css";

const terminalHost = document.querySelector<HTMLElement>("#terminal")!;
const tabsHost = document.querySelector<HTMLElement>("#tabs")!;
const newTabBtn = document.querySelector<HTMLButtonElement>("#new-tab")!;
const themeSelect = document.querySelector<HTMLSelectElement>("#theme")!;
const statusCwd = document.querySelector<HTMLElement>("#status-cwd")!;
const statusPid = document.querySelector<HTMLElement>("#status-pid")!;
const statusProc = document.querySelector<HTMLElement>("#status-proc")!;
const statusCpu = document.querySelector<HTMLElement>("#status-cpu")!;
const statusMem = document.querySelector<HTMLElement>("#status-mem")!;
const statusProcs = document.querySelector<HTMLElement>("#status-procs")!;

interface Stats {
  pid: number;
  cwd: string | null;
  rssBytes: number;
  cpuPct: number;
  count: number;
  proc: string;
}

function prettyCwd(cwd: string | null): string {
  if (!cwd) return "–";
  const m = cwd.match(/^\/home\/[^/]+/);
  if (m && cwd.startsWith(m[0])) return "~" + cwd.slice(m[0].length);
  return cwd;
}

function cwdBasename(cwd: string | null): string {
  if (!cwd) return "";
  const m = cwd.match(/^\/home\/[^/]+$/);
  if (m) return "~";
  if (cwd === "/") return "/";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "/";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface Tab {
  id: string;
  mount: HTMLElement;
  term: WTerm;
  tabEl: HTMLElement;
  labelEl: HTMLElement;
  lastCols: number;
  lastRows: number;
  stats: Stats | null;
  opened: boolean;
}

const tabs: Tab[] = [];
let activeId: string | null = null;
let tabCounter = 0;

const THEME_CLASSES = ["theme-solarized-dark", "theme-monokai", "theme-light"];

function applyTheme(el: HTMLElement, value: string) {
  for (const c of THEME_CLASSES) el.classList.remove(c);
  if (value) el.classList.add(value);
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/terminal`;
}

let ws: WebSocket;
const pendingOpens: Array<() => void> = [];
let wsReady = false;

function sendJSON(data: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function connect() {
  ws = new WebSocket(wsUrl());
  wsReady = false;
  ws.addEventListener("open", () => {
    wsReady = true;
    for (const fn of pendingOpens.splice(0)) fn();
  });
  ws.addEventListener("message", async (event) => {
    const text =
      typeof event.data === "string" ? event.data : await event.data.text();
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    handleServerMessage(msg);
  });
  ws.addEventListener("close", () => {
    for (const t of tabs) t.term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
  });
}

function handleServerMessage(msg: any) {
  switch (msg.type) {
    case "tabs": {
      const serverIds: string[] = (msg.tabs ?? []).map((t: any) => t.id);
      for (const sid of serverIds) {
        if (!tabs.find((t) => t.id === sid)) attachExistingTab(sid);
      }
      if (tabs.length === 0) {
        addTab();
      } else {
        if (!activeId) activate(tabs[0].id);
        if (activeId) sendJSON({ type: "rerender", sid: activeId });
      }
      return;
    }
    case "opened": {
      let tab = tabs.find((t) => t.id === msg.sid);
      if (!tab) tab = attachExistingTab(msg.sid);
      tab.opened = true;
      return;
    }
    case "closed": {
      const idx = tabs.findIndex((t) => t.id === msg.sid);
      if (idx === -1) return;
      const tab = tabs[idx];
      tab.mount.remove();
      tab.tabEl.remove();
      tabs.splice(idx, 1);
      if (activeId === msg.sid) {
        activeId = null;
        const next = tabs[idx] ?? tabs[idx - 1];
        if (next) activate(next.id);
        else addTab();
      }
      return;
    }
    case "data": {
      const tab = tabs.find((t) => t.id === msg.sid);
      if (tab) tab.term.write(msg.data);
      return;
    }
    case "stats": {
      const tab = tabs.find((t) => t.id === msg.sid);
      if (!tab) return;
      tab.stats = {
        pid: msg.pid,
        cwd: msg.cwd,
        rssBytes: msg.rssBytes,
        cpuPct: msg.cpuPct,
        count: msg.count,
        proc: msg.proc,
      };
      const label = tab.stats.proc || cwdBasename(tab.stats.cwd);
      if (label) tab.labelEl.textContent = label;
      if (activeId === tab.id) renderStatus(tab);
      return;
    }
    case "error": {
      const tab = tabs.find((t) => t.id === msg.sid);
      if (tab) tab.term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
      return;
    }
  }
}

function createTab(idArg?: string): Tab {
  tabCounter += 1;
  const id = idArg ?? `session-${tabCounter}-${Date.now()}`;
  const name = `Session ${tabCounter}`;

  const mount = document.createElement("div");
  mount.className = "terminal-mount";
  mount.style.position = "absolute";
  mount.style.inset = "0";
  mount.style.visibility = "hidden";
  terminalHost.appendChild(mount);

  const initialCols = 80;
  const initialRows = 24;

  const term = new WTerm(mount, {
    cols: initialCols,
    rows: initialRows,
    autoResize: true,
    onData: (data) => sendJSON({ type: "input", sid: id, data }),
    onResize: (cols, rows) => {
      if (activeId !== id) return;
      if (cols === tab.lastCols && rows === tab.lastRows) return;
      tab.lastCols = cols;
      tab.lastRows = rows;
      sendJSON({ type: "resize", sid: id, cols, rows });
    },
    onTitle: (t) => {
      if (activeId === id) document.title = t;
    },
  });

  term.init();
  applyTheme(mount, themeSelect.value);

  const tabEl = document.createElement("button");
  tabEl.className = "tab";
  tabEl.type = "button";
  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = name;
  tabEl.appendChild(label);

  const closeBtn = document.createElement("span");
  closeBtn.className = "tab-close";
  closeBtn.setAttribute("role", "button");
  closeBtn.setAttribute("aria-label", `Close ${name}`);
  closeBtn.textContent = "×";
  tabEl.appendChild(closeBtn);

  tabsHost.insertBefore(tabEl, newTabBtn);

  const tab: Tab = {
    id,
    mount,
    term,
    tabEl,
    labelEl: label,
    lastCols: initialCols,
    lastRows: initialRows,
    stats: null,
    opened: false,
  };

  tabEl.addEventListener("click", (e) => {
    if (e.target === closeBtn) return;
    activate(id);
  });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(id);
  });

  return tab;
}

function openSession(tab: Tab) {
  const send = () =>
    sendJSON({
      type: "open",
      sid: tab.id,
      cols: tab.lastCols,
      rows: tab.lastRows,
    });
  if (wsReady) send();
  else pendingOpens.push(send);
}

function renderStatus(tab: Tab | null) {
  if (!tab || !tab.stats) {
    statusCwd.textContent = "–";
    statusProc.textContent = "–";
    statusPid.textContent = "pid –";
    statusCpu.textContent = "CPU –";
    statusMem.textContent = "MEM –";
    statusProcs.textContent = "– procs";
    return;
  }
  const s = tab.stats;
  statusCwd.textContent = prettyCwd(s.cwd);
  statusProc.textContent = s.proc || "–";
  statusPid.textContent = `pid ${s.pid}`;
  statusCpu.textContent = `CPU ${s.cpuPct.toFixed(1)}%`;
  statusMem.textContent = `MEM ${formatBytes(s.rssBytes)}`;
  statusProcs.textContent = `${s.count} proc${s.count === 1 ? "" : "s"}`;
}

function activate(id: string) {
  const prev = activeId;
  activeId = id;
  let active: Tab | null = null;
  for (const t of tabs) {
    const isActive = t.id === id;
    t.mount.style.visibility = isActive ? "visible" : "hidden";
    t.tabEl.classList.toggle("active", isActive);
    if (isActive) {
      t.term.focus();
      active = t;
    }
  }
  renderStatus(active);
  if (active && prev !== id) {
    sendJSON({ type: "rerender", sid: active.id });
  }
}

function closeTab(id: string) {
  sendJSON({ type: "close", sid: id });
}

function addTab() {
  const t = createTab();
  tabs.push(t);
  openSession(t);
  activate(t.id);
}

function attachExistingTab(sid: string): Tab {
  const t = createTab(sid);
  tabs.push(t);
  t.opened = true;
  return t;
}

newTabBtn.addEventListener("click", addTab);

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
    e.preventDefault();
    addTab();
  }
});

connect();

themeSelect.addEventListener("change", () => {
  for (const t of tabs) applyTheme(t.mount, themeSelect.value);
});
