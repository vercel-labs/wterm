import {
  MAX_PANES,
  type Layout,
  type WorkspaceState,
} from "./workspace-layout";

const MAX_RECORD_LENGTH = 8192;
type Arrangement = Pick<
  WorkspaceState,
  "layout" | "activeId" | "zoomed" | "nextNumber"
>;

/** Layout is presentation only; the recovery registry owns session identity. */
export function restoreLayout(
  raw: string | null,
  ids: readonly string[],
): Arrangement | null {
  if (!raw || raw.length > MAX_RECORD_LENGTH) return null;
  try {
    const saved = JSON.parse(raw);
    if (
      saved?.version !== 1 ||
      !Array.isArray(saved.ids) ||
      saved.ids.length !== ids.length ||
      !saved.ids.every((id: unknown, index: number) => id === ids[index]) ||
      typeof saved.zoomed !== "boolean" ||
      !Number.isSafeInteger(saved.nextNumber) ||
      saved.nextNumber < 1 ||
      saved.nextNumber > 1_000_000_000 ||
      ids.some((id) => Number(id.slice(8)) >= saved.nextNumber)
    )
      return null;

    const panes = new Set<string>();
    const splits = new Set<string>();
    let nodes = 0;
    function read(value: unknown): Layout {
      if (++nodes > MAX_PANES * 2 - 1 || !value || typeof value !== "object")
        throw new Error();
      const node = value as Record<string, unknown>;
      if (node.kind === "pane") {
        if (
          typeof node.session !== "string" ||
          !ids.includes(node.session) ||
          panes.has(node.session) ||
          panes.size >= MAX_PANES
        )
          throw new Error();
        panes.add(node.session);
        return { kind: "pane", session: node.session };
      }
      if (
        node.kind !== "split" ||
        typeof node.id !== "string" ||
        !/^split-[1-9][0-9]{0,8}$/.test(node.id) ||
        Number(node.id.slice(6)) >= saved.nextNumber ||
        splits.has(node.id) ||
        (node.direction !== "right" && node.direction !== "down") ||
        typeof node.ratio !== "number" ||
        !Number.isFinite(node.ratio) ||
        node.ratio < 0 ||
        node.ratio > 1
      )
        throw new Error();
      splits.add(node.id);
      return {
        kind: "split",
        id: node.id,
        direction: node.direction,
        ratio: node.ratio,
        first: read(node.first),
        second: read(node.second),
      };
    }
    const layout = ids.length ? read(saved.layout) : null;
    if (
      ids.length
        ? !panes.has(saved.activeId)
        : saved.layout !== null || saved.activeId !== null || saved.zoomed
    )
      return null;
    return {
      layout,
      activeId: saved.activeId,
      zoomed: saved.zoomed,
      nextNumber: saved.nextNumber,
    };
  } catch {
    return null;
  }
}

export function serializeLayout(workspace: WorkspaceState): string {
  return JSON.stringify({
    version: 1,
    ids: workspace.sessions.map((session) => session.id),
    layout: workspace.layout,
    activeId: workspace.activeId,
    zoomed: workspace.zoomed,
    nextNumber: workspace.nextNumber,
  });
}
