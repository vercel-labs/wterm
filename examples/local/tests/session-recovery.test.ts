import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RecoveryLog,
  SessionRecovery,
  RECOVERY_BYTES,
  RECOVERY_EVENTS,
  decodeOutput,
} from "../lib/session-recovery";

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
const state = { session: "a".repeat(64), bytes: 0, inputSent: 0, inputAck: 0 };

test("committed replay retains exact binary fragments, resize order, themes and input counters", () => {
  const storage = new MemoryStorage();
  const log = new RecoveryLog(storage, "session");
  log.start(80, 24, "dark");
  log.checkpoint(state);
  const source = Buffer.from("語\x1b[38;2;255;");
  log.write(source.subarray(0, 2));
  log.append({ type: "resize", cols: 10, rows: 5 });
  log.append({ type: "resize", cols: 100, rows: 30 });
  log.append({ type: "theme", theme: "light" });
  log.write(source.subarray(2));
  log.checkpoint({ ...state, bytes: source.length, inputSent: 9, inputAck: 8 });
  const restored = new RecoveryLog(storage, "session", true);
  assert.equal(restored.failed, false);
  assert.deepEqual(restored.replay, log.replay);
  assert.equal(restored.saved?.bytes, source.length);
  assert.equal(restored.saved?.inputSent, 9);
  assert.equal(restored.saved?.inputAck, 8);
  assert.deepEqual(
    Buffer.concat(
      restored.replay
        .filter((event) => event.type === "output")
        .map((event) => decodeOutput(event.data)),
    ),
    source,
  );
});

test("uncommitted appends do not advance the saved prefix and missing committed records fail closed", () => {
  const storage = new MemoryStorage();
  const log = new RecoveryLog(storage, "session");
  log.start(80, 24, "dark");
  log.write(Buffer.from("first"));
  log.checkpoint({ ...state, bytes: 5 });
  log.write(Buffer.from("not committed"));
  assert.equal(new RecoveryLog(storage, "session", true).saved?.bytes, 5);
  storage.removeItem("session.0");
  assert.equal(new RecoveryLog(storage, "session", true).failed, true);
});

test("byte and event limits discard replay instead of keeping a misleading suffix", () => {
  for (const kind of ["bytes", "events"]) {
    const storage = new MemoryStorage();
    const log = new RecoveryLog(storage, "session");
    log.start(80, 24, "dark");
    log.checkpoint(state);
    if (kind === "bytes") {
      for (let bytes = 0; bytes <= RECOVERY_BYTES; bytes += 16384)
        log.write(new Uint8Array(16384));
    } else {
      for (let i = 0; i <= RECOVERY_EVENTS; i++)
        log.append({ type: "resize", cols: 80, rows: 24 });
    }
    assert.equal(log.failed, true);
    assert.equal(log.replay.length, 0);
    assert.equal(new RecoveryLog(storage, "session", true).failed, true);
  }
});

test("quota failures invalidate saved state without preventing subsequent live use", () => {
  const storage = new MemoryStorage();
  const log = new RecoveryLog(storage, "session");
  log.start(80, 24, "dark");
  log.write(Buffer.from("saved"));
  log.checkpoint({ ...state, bytes: 5 });
  storage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  log.write(Buffer.from("new"));
  assert.doesNotThrow(() => log.checkpoint({ ...state, bytes: 8 }));
  assert.equal(log.failed, true);
  assert.equal(new RecoveryLog(storage, "session", true).failed, true);
});

test("reload restores session identities, explicit close removes them, and ordinary navigation starts independently", () => {
  const storage = new MemoryStorage();
  const store = new SessionRecovery(storage, "route", false);
  for (const id of ["session-1", "session-4"]) {
    const log = store.get(id);
    log.start(80, 24, "dark");
    log.checkpoint(state);
  }
  const restored = new SessionRecovery(storage, "route", true);
  assert.deepEqual(
    restored.initial.sessions.map((session) => session.id),
    ["session-1", "session-4"],
  );
  assert.equal(restored.initial.nextNumber, 5);
  restored.remove("session-1");
  assert.deepEqual(
    new SessionRecovery(storage, "route", true).initial.sessions.map(
      (session) => session.id,
    ),
    ["session-4"],
  );
  assert.equal(
    new SessionRecovery(storage, "route", false).has("session-4"),
    false,
  );
  assert.equal(storage.getItem("route:session-4"), null);
});

test("malformed registries and unsafe input counters cannot silently create replacement shells", () => {
  const storage = new MemoryStorage();
  storage.setItem("route", "invalid");
  const store = new SessionRecovery(storage, "route", true);
  assert.equal(store.has("session-1"), true);
  assert.equal(store.get("session-1").failed, true);
  const log = new RecoveryLog(storage, "session");
  log.start(80, 24, "dark");
  log.checkpoint(state);
  const valid = storage.getItem("session")!;
  for (const invalid of [
    { inputSent: 2000 },
    { inputAck: 1 },
    { cols: 0 },
    { bytes: 1 },
    { count: -1 },
  ]) {
    storage.setItem(
      "session",
      JSON.stringify({ ...JSON.parse(valid), ...invalid }),
    );
    assert.equal(new RecoveryLog(storage, "session", true).failed, true);
  }
});

test("denied registry writes disable recovery and missing registries fail closed on reload", () => {
  const storage = new MemoryStorage();
  const store = new SessionRecovery(storage, "route", false);
  const original = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === "route") throw new Error("Quota exceeded");
    original(key, value);
  };
  const log = store.get("session-1");
  assert.equal(log.failed, true);
  assert.equal(
    new SessionRecovery(storage, "route", true).get("session-1").failed,
    true,
  );
  assert.equal(
    new SessionRecovery(null, "route", true).get("session-1").failed,
    true,
  );
});

test("closing the last session restores an empty workspace", () => {
  const storage = new MemoryStorage();
  const store = new SessionRecovery(storage, "route", false);
  store.get("session-1");
  store.remove("session-1");
  assert.deepEqual(
    new SessionRecovery(storage, "route", true).initial.sessions,
    [],
  );
});

test("closing a damaged record removes orphan output as well as its credentials", () => {
  const storage = new MemoryStorage();
  storage.setItem("session", "broken");
  storage.setItem("session.0", "sensitive output");
  storage.setItem("unrelated", "keep");
  new RecoveryLog(storage, "session", true).remove();
  assert.deepEqual([...storage.values], [["unrelated", "keep"]]);
});
