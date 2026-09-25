import type { HarnessAPI } from "../harness/src/main";

type Snapshot = ReturnType<HarnessAPI["snapshot"]>;

export type Checkpoint = {
  rows?: Record<number, string>;
  renderedRows?: Record<number, string>;
  cursor?: Partial<Snapshot["cursor"]>;
  modes?: Partial<Snapshot["modes"]>;
  cells?: {
    row: number;
    col: number;
    value: Partial<Snapshot["cells"][number][number]>;
  }[];
  cols?: number;
  height?: number;
  scrollbackCount?: number;
  history?: string[];
  styles?: { row: number; text: string; color: string; fontWeight: string }[];
  responses?: string[];
};

export type ReplayEvent = { atMs: number } & (
  | { type: "output"; data: string }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "checkpoint"; name: string; expected: Checkpoint }
);

export type ReplayFixture = {
  schemaVersion: 1;
  id: string;
  source: { kind: "pty" | "protocol"; [key: string]: unknown };
  cols: number;
  rows: number;
  events: ReplayEvent[];
};
