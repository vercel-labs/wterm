import type { WorkspaceState } from "./workspace-layout";
import { INITIAL_STATE } from "./workspace-layout";
import { INPUT_MESSAGES, SESSION_LIMIT } from "./terminal-protocol";

export const RECOVERY_BYTES = 1024 * 1024;
export const RECOVERY_EVENTS = 4096;
export const RECOVERY_KEY = "wterm.local.recovery.v1";
export interface ConnectionState {
  session: string;
  bytes: number;
  inputSent: number;
  inputAck: number;
}
export type ReplayEvent =
  | { type: "output"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "theme"; theme: "dark" | "light" };
export interface RecoveryHead extends ConnectionState {
  cols: number;
  rows: number;
  theme: "dark" | "light";
  count: number;
  error: boolean;
}
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= max;
const size = (value: { cols?: unknown; rows?: unknown }) =>
  integer(value.cols, 1024) &&
  Number(value.cols) > 0 &&
  integer(value.rows, 512) &&
  Number(value.rows) > 0;
const theme = (value: unknown) => value === "dark" || value === "light";
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^session-[1-9][0-9]{0,8}$/.test(value);

export function decodeOutput(data: string): Uint8Array {
  if (
    data.length > 24 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  )
    throw new Error("Invalid saved output");
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}

/** Append records first, then commit the head before acknowledging output. */
export class RecoveryLog {
  private events: ReplayEvent[] = [];
  private outputBytes = 0;
  private storedCount = 0;
  private head: RecoveryHead | null = null;
  failed = false;

  constructor(
    private storage: Storage | null,
    private key: string,
    readonly restore = false,
  ) {
    if (!restore) return;
    try {
      const raw = storage?.getItem(key);
      if (!raw || raw.length > 1024) throw new Error();
      const head: RecoveryHead = JSON.parse(raw);
      if (
        !size(head) ||
        !theme(head.theme) ||
        typeof head.session !== "string" ||
        !/^[a-f0-9]{64}$/.test(head.session) ||
        !integer(head.bytes, RECOVERY_BYTES) ||
        !integer(head.count, RECOVERY_EVENTS) ||
        !integer(head.inputAck) ||
        !integer(head.inputSent) ||
        head.inputAck > head.inputSent ||
        head.inputSent - head.inputAck > INPUT_MESSAGES ||
        head.error !== false
      )
        throw new Error();
      this.head = head;
      this.storedCount = head.count;
      for (let i = 0; i < head.count; i++) {
        const rawEvent = storage?.getItem(`${key}.${i}`);
        if (!rawEvent || rawEvent.length > 25 * 1024) throw new Error();
        const event: ReplayEvent = JSON.parse(rawEvent);
        if (event?.type === "output" && typeof event.data === "string") {
          this.outputBytes += decodeOutput(event.data).length;
          if (this.outputBytes > RECOVERY_BYTES) throw new Error();
        } else if (event?.type === "resize" && size(event)) {
          // Exact sizes matter even when several resizes precede more output.
        } else if (event?.type !== "theme" || !theme(event.theme))
          throw new Error();
        this.events.push(event);
      }
      if (this.outputBytes !== head.bytes) throw new Error();
      this.storedCount = head.count;
    } catch {
      this.failed = true;
      this.events = [];
      this.head = null;
    }
  }

  get saved(): RecoveryHead | null {
    return this.failed || !this.head ? null : { ...this.head };
  }
  get replay(): readonly ReplayEvent[] {
    return this.events;
  }

  start(cols: number, rows: number, appearance: "dark" | "light"): void {
    if (this.head || this.failed) return;
    this.head = {
      session: "",
      bytes: 0,
      inputSent: 0,
      inputAck: 0,
      cols,
      rows,
      theme: appearance,
      count: 0,
      error: false,
    };
  }

  append(event: ReplayEvent): void {
    if (this.failed || !this.head) return;
    if (event.type === "output")
      this.outputBytes += decodeOutput(event.data).length;
    if (
      this.outputBytes > RECOVERY_BYTES ||
      this.events.length >= RECOVERY_EVENTS
    ) {
      this.invalidate();
      return;
    }
    this.events.push(event);
  }

  write(data: Uint8Array): void {
    if (this.failed) return;
    this.append({ type: "output", data: btoa(String.fromCharCode(...data)) });
  }

  checkpoint(state?: ConnectionState): void {
    if (!this.head || this.failed) return;
    if (state) Object.assign(this.head, state);
    if (!this.head.session) return;
    try {
      if (!this.storage) throw new Error();
      while (this.storedCount < this.events.length) {
        this.storage.setItem(
          `${this.key}.${this.storedCount}`,
          JSON.stringify(this.events[this.storedCount]),
        );
        this.storedCount++;
      }
      this.head.count = this.events.length;
      this.head.bytes = this.outputBytes;
      this.storage.setItem(this.key, JSON.stringify(this.head));
    } catch {
      this.invalidate();
    }
  }

  invalidate(): void {
    this.failed = true;
    if (this.head) this.head.error = true;
    try {
      this.storage?.setItem(this.key, JSON.stringify({ error: true }));
    } catch {
      try {
        this.storage?.removeItem(this.key);
      } catch {}
    }
    for (let i = 0; i < this.storedCount; i++) {
      try {
        this.storage?.removeItem(`${this.key}.${i}`);
      } catch {}
    }
    this.events = [];
    this.storedCount = 0;
  }

  remove(): void {
    this.invalidate();
    try {
      // Also remove orphan records left by an interrupted commit or invalid head.
      if (this.storage) {
        for (let index = this.storage.length - 1; index >= 0; index--) {
          const key = this.storage.key(index);
          if (key?.startsWith(`${this.key}.`)) this.storage.removeItem(key);
        }
      }
      this.storage?.removeItem(this.key);
    } catch {}
  }
}

/** Output and credentials stay in this tab's sessionStorage, scoped to its engine route. */
export class SessionRecovery {
  readonly initial: WorkspaceState;
  private logs = new Map<string, RecoveryLog>();
  private ids: string[] = [];

  constructor(
    private storage: Storage | null,
    private key: string,
    restore: boolean,
  ) {
    let invalid = false;
    try {
      const raw = storage?.getItem(key);
      if (restore && raw == null) throw new Error();
      if (raw && raw.length > 2048) throw new Error();
      const ids: unknown = raw ? JSON.parse(raw) : [];
      if (
        !Array.isArray(ids) ||
        ids.length > SESSION_LIMIT ||
        !ids.every(validId) ||
        new Set(ids).size !== ids.length
      )
        throw new Error();
      this.ids = ids;
      for (const id of ids)
        this.logs.set(id, new RecoveryLog(storage, `${key}:${id}`, true));
    } catch {
      invalid = true;
    }
    if (!restore) {
      for (const log of this.logs.values()) log.remove();
      this.ids = [];
      this.logs.clear();
      this.saveIndex();
      this.initial = INITIAL_STATE;
    } else if (invalid) {
      // A malformed registry must not turn an attempted restore into a new PTY.
      this.ids = ["session-1"];
      this.logs.set("session-1", new RecoveryLog(null, "", true));
      this.initial = INITIAL_STATE;
    } else if (!this.ids.length) {
      this.initial = {
        ...INITIAL_STATE,
        sessions: [],
        activeId: null,
        layout: null,
      };
    } else {
      const sessions = this.ids.map((id) => ({
        ...INITIAL_STATE.sessions[0],
        id,
        name: `Terminal ${id.slice(8)}`,
      }));
      this.initial = {
        sessions,
        activeId: sessions[0].id,
        nextNumber: Math.max(...this.ids.map((id) => Number(id.slice(8)))) + 1,
        layout: { kind: "pane", session: sessions[0].id },
        zoomed: false,
      };
    }
  }

  private saveIndex(): void {
    try {
      if (!this.storage) throw new Error();
      this.storage.setItem(this.key, JSON.stringify(this.ids));
    } catch {
      for (const log of this.logs.values()) log.invalidate();
      try {
        this.storage?.removeItem(this.key);
      } catch {}
    }
  }

  has(id: string): boolean {
    return this.logs.has(id);
  }
  get(id: string): RecoveryLog {
    let log = this.logs.get(id);
    if (!log) {
      if (!validId(id) || this.ids.length >= SESSION_LIMIT)
        return new RecoveryLog(null, "", true);
      log = new RecoveryLog(this.storage, `${this.key}:${id}`);
      this.logs.set(id, log);
      this.ids.push(id);
      this.saveIndex();
    }
    return log;
  }
  remove(id: string): void {
    this.logs.get(id)?.remove();
    this.logs.delete(id);
    this.ids = this.ids.filter((value) => value !== id);
    this.saveIndex();
  }
}
