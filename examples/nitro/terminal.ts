import { defineWebSocketHandler } from "nitro";
import type { Peer } from "crossws";
import { spawn, type IPty } from "zigpty";

interface Session {
  id: string;
  pty: IPty;
  cols: number;
  rows: number;
  lastCpuUser: number;
  lastCpuSys: number;
  lastSampleAt: number;
  lastStats: StatsPayload | null;
}

interface StatsPayload {
  type: "stats";
  sid: string;
  pid: number;
  cwd: string | null;
  rssBytes: number;
  cpuPct: number;
  count: number;
  proc: string;
}

const sessions = new Map<string, Session>();
const peers = new Set<Peer>();

function broadcast(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const peer of peers) peer.send(text);
}

function createSession(id: string, cols: number, rows: number): Session {
  const pty = spawn(process.env.SHELL || "/bin/bash", [], {
    cols,
    rows,
    cwd: process.env.HOME,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  const session: Session = {
    id,
    pty,
    cols,
    rows,
    lastCpuUser: 0,
    lastCpuSys: 0,
    lastSampleAt: 0,
    lastStats: null,
  };
  sessions.set(id, session);
  console.log(`[terminal] session opened: ${id} (pid=${pty.pid}, ${cols}x${rows})`);

  pty.onData((data) => {
    broadcast({ type: "data", sid: id, data });
  });
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    console.log(`[terminal] session exited: ${id} (exitCode=${exitCode})`);
    broadcast({ type: "closed", sid: id, exitCode });
  });

  return session;
}

function sampleStats(session: Session): StatsPayload | null {
  const s = session.pty.stats();
  if (!s) return null;
  const now = Date.now();
  const elapsedUs = session.lastSampleAt ? (now - session.lastSampleAt) * 1000 : 0;
  const cpuDelta = s.cpuUser + s.cpuSys - session.lastCpuUser - session.lastCpuSys;
  const cpuPct = elapsedUs > 0 ? Math.max(0, (cpuDelta / elapsedUs) * 100) : 0;
  session.lastCpuUser = s.cpuUser;
  session.lastCpuSys = s.cpuSys;
  session.lastSampleAt = now;

  const payload: StatsPayload = {
    type: "stats",
    sid: session.id,
    pid: s.pid,
    cwd: s.cwd,
    rssBytes: s.rssBytes,
    cpuPct,
    count: s.count,
    proc: session.pty.process,
  };
  session.lastStats = payload;
  return payload;
}

setInterval(() => {
  if (peers.size === 0) return;
  for (const session of sessions.values()) {
    const payload = sampleStats(session);
    if (payload) broadcast(payload);
  }
}, 1000).unref();

export default defineWebSocketHandler({
  open(peer) {
    peers.add(peer);
    console.log(`[terminal] peer connected (peers=${peers.size})`);
    const tabs = [...sessions.values()].map((s) => ({
      id: s.id,
      stats: sampleStats(s) ?? s.lastStats,
    }));
    peer.send(JSON.stringify({ type: "tabs", tabs }));
    for (const tab of tabs) {
      if (tab.stats) peer.send(JSON.stringify(tab.stats));
    }
  },

  message(peer, message) {
    const text = message.text();
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    const sid: string | undefined = msg.sid;

    switch (msg.type) {
      case "open": {
        if (!sid) return;
        if (sessions.has(sid)) {
          peer.send(JSON.stringify({ type: "opened", sid }));
          return;
        }
        try {
          createSession(sid, Number(msg.cols) || 80, Number(msg.rows) || 24);
          broadcast({ type: "opened", sid });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[terminal] failed to open session ${sid}: ${errMsg}`);
          peer.send(
            JSON.stringify({ type: "error", sid, message: errMsg }),
          );
        }
        return;
      }
      case "close": {
        if (!sid) return;
        const s = sessions.get(sid);
        if (s) s.pty.kill();
        return;
      }
      case "input": {
        if (!sid) return;
        const s = sessions.get(sid);
        if (s) s.pty.write(msg.data);
        return;
      }
      case "resize": {
        if (!sid) return;
        const s = sessions.get(sid);
        if (!s) return;
        s.cols = Number(msg.cols) || s.cols;
        s.rows = Number(msg.rows) || s.rows;
        s.pty.resize(s.cols, s.rows);
        return;
      }
      case "rerender": {
        if (!sid) return;
        const s = sessions.get(sid);
        if (s) s.pty.write("\x0c");
        return;
      }
    }
  },

  close(peer) {
    peers.delete(peer);
    console.log(`[terminal] peer disconnected (peers=${peers.size})`);
  },

  error(peer, error) {
    peers.delete(peer);
    console.error(`[terminal] peer error (peers=${peers.size}):`, error);
  },
});
