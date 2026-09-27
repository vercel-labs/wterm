import type { ShellIntegrationState } from "@wterm/core";

export type SessionStatus =
  "loading" | "connecting" | "reconnecting" | "connected" | "closed";
export type SplitDirection = "right" | "down";
export type Layout =
  | { kind: "pane"; session: string }
  | {
      kind: "split";
      id: string;
      direction: SplitDirection;
      ratio: number;
      first: Layout;
      second: Layout;
    };
export interface Session {
  id: string;
  name: string;
  status: SessionStatus;
  cwd: string | null;
  focusRequest: number;
  shell: ShellIntegrationState | null;
}
export interface WorkspaceState {
  sessions: Session[];
  activeId: string | null;
  nextNumber: number;
  layout: Layout | null;
  zoomed: boolean;
}
export type WorkspaceAction =
  | { type: "add" }
  | { type: "split"; id: string; direction: SplitDirection }
  | { type: "select" | "focus" | "close" | "zoom"; id: string }
  | { type: "resize"; id: string; ratio: number }
  | { type: "status"; id: string; status: SessionStatus }
  | { type: "cwd"; id: string; cwd: string }
  | { type: "shell"; id: string; shell: ShellIntegrationState };

export const MAX_PANES = 4;
export const DIVIDER_SIZE = 8;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 220;
const pane = (session: string): Layout => ({ kind: "pane", session });
const session = (number: number): Session => ({
  id: `session-${number}`,
  name: `Terminal ${number}`,
  status: "connecting",
  cwd: null,
  focusRequest: 1,
  shell: null,
});
export const INITIAL_STATE: WorkspaceState = {
  sessions: [session(1)],
  activeId: "session-1",
  nextNumber: 2,
  layout: pane("session-1"),
  zoomed: false,
};

export function visibleSessions(layout: Layout | null): string[] {
  if (!layout) return [];
  return layout.kind === "pane"
    ? [layout.session]
    : [...visibleSessions(layout.first), ...visibleSessions(layout.second)];
}

function replace(layout: Layout, id: string, replacement: Layout): Layout {
  if (layout.kind === "pane")
    return layout.session === id ? replacement : layout;
  return {
    ...layout,
    first: replace(layout.first, id, replacement),
    second: replace(layout.second, id, replacement),
  };
}
function remove(layout: Layout | null, id: string): Layout | null {
  if (!layout) return null;
  if (layout.kind === "pane") return layout.session === id ? null : layout;
  const first = remove(layout.first, id);
  const second = remove(layout.second, id);
  return first && second ? { ...layout, first, second } : (first ?? second);
}
function sibling(layout: Layout | null, id: string): string | null {
  if (!layout || layout.kind === "pane") return null;
  if (layout.first.kind === "pane" && layout.first.session === id)
    return visibleSessions(layout.second)[0];
  if (layout.second.kind === "pane" && layout.second.session === id)
    return visibleSessions(layout.first).at(-1) ?? null;
  return sibling(layout.first, id) ?? sibling(layout.second, id);
}
function resize(layout: Layout, id: string, ratio: number): Layout {
  if (layout.kind === "pane") return layout;
  if (layout.id === id) return { ...layout, ratio };
  return {
    ...layout,
    first: resize(layout.first, id, ratio),
    second: resize(layout.second, id, ratio),
  };
}
function requestFocus(sessions: Session[], id: string | null): Session[] {
  return sessions.map((item) =>
    item.id === id ? { ...item, focusRequest: item.focusRequest + 1 } : item,
  );
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  const visible = visibleSessions(state.layout);
  switch (action.type) {
    case "add":
    case "split": {
      if (
        action.type === "split" &&
        (!visible.includes(action.id) || visible.length >= MAX_PANES)
      )
        return state;
      const next = session(state.nextNumber);
      const target = action.type === "split" ? action.id : state.activeId;
      const replacement: Layout =
        action.type === "split"
          ? {
              kind: "split",
              id: `split-${state.nextNumber}`,
              direction: action.direction,
              ratio: 0.5,
              first: pane(action.id),
              second: pane(next.id),
            }
          : pane(next.id);
      return {
        ...state,
        sessions: [...state.sessions, next],
        activeId: next.id,
        zoomed: action.type === "split" ? false : state.zoomed,
        nextNumber: state.nextNumber + 1,
        layout:
          state.layout && target
            ? replace(state.layout, target, replacement)
            : replacement,
      };
    }
    case "focus":
      return visible.includes(action.id) && state.activeId !== action.id
        ? { ...state, activeId: action.id }
        : state;
    case "select":
    case "zoom": {
      if (!state.sessions.some((item) => item.id === action.id)) return state;
      return {
        ...state,
        sessions: requestFocus(state.sessions, action.id),
        activeId: action.id,
        zoomed:
          action.type === "zoom"
            ? !(state.zoomed && state.activeId === action.id)
            : state.zoomed,
        layout:
          !state.layout || !state.activeId
            ? pane(action.id)
            : visible.includes(action.id)
              ? state.layout
              : replace(state.layout, state.activeId, pane(action.id)),
      };
    }
    case "close": {
      const index = state.sessions.findIndex((item) => item.id === action.id);
      if (index === -1) return state;
      const sessions = state.sessions.filter((item) => item.id !== action.id);
      const layout = remove(state.layout, action.id);
      const remaining = visibleSessions(layout);
      const activeId =
        state.activeId === action.id
          ? (sibling(state.layout, action.id) ??
            remaining[0] ??
            sessions[index]?.id ??
            sessions[index - 1]?.id ??
            null)
          : state.activeId;
      return {
        ...state,
        sessions: requestFocus(sessions, activeId),
        activeId,
        zoomed: state.activeId === action.id ? false : state.zoomed,
        layout: layout ?? (activeId ? pane(activeId) : null),
      };
    }
    case "resize":
      return state.layout && Number.isFinite(action.ratio)
        ? {
            ...state,
            layout: resize(
              state.layout,
              action.id,
              Math.max(0, Math.min(1, action.ratio)),
            ),
          }
        : state;
    case "status":
      return {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === action.id ? { ...item, status: action.status } : item,
        ),
      };
    case "cwd":
      return {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === action.id ? { ...item, cwd: action.cwd } : item,
        ),
      };
    case "shell": {
      const current = state.sessions.find((item) => item.id === action.id);
      if (
        !current ||
        (current.shell?.phase === action.shell.phase &&
          current.shell?.exitCode === action.shell.exitCode)
      )
        return state;
      return {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === action.id
            ? { ...item, shell: { ...action.shell } }
            : item,
        ),
      };
    }
  }
}

export function shellLabel(session: Session): string | null {
  const shell = session.shell;
  if (session.status !== "connected" || !shell || shell.phase === "unknown")
    return null;
  if (shell.phase === "running") return "Running";
  if (shell.exitCode !== null)
    return shell.exitCode === 0 ? "Done" : `Exit ${shell.exitCode}`;
  return shell.phase === "complete" ? "Done" : "Ready";
}

export function minimumSize(layout: Layout | null): {
  width: number;
  height: number;
} {
  if (!layout || layout.kind === "pane")
    return { width: MIN_WIDTH, height: MIN_HEIGHT };
  const first = minimumSize(layout.first);
  const second = minimumSize(layout.second);
  return layout.direction === "right"
    ? {
        width: first.width + second.width + DIVIDER_SIZE,
        height: Math.max(first.height, second.height),
      }
    : {
        width: Math.max(first.width, second.width),
        height: first.height + second.height + DIVIDER_SIZE,
      };
}
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Divider extends Rect {
  id: string;
  direction: SplitDirection;
  container: Rect;
  ratio: number;
  min: number;
  max: number;
  primary: string[];
}

/** Flatten geometry so React never reparents terminal instances when splits change. */
export function measureLayout(
  layout: Layout | null,
  width: number,
  height: number,
) {
  const panes: Record<string, Rect> = {};
  const dividers: Divider[] = [];
  const visit = (node: Layout, rect: Rect) => {
    if (node.kind === "pane") {
      panes[node.session] = rect;
      return;
    }
    const horizontal = node.direction === "right";
    const axis = horizontal ? "width" : "height";
    const available = rect[axis] - DIVIDER_SIZE;
    const min = minimumSize(node.first)[axis] / available;
    const max = 1 - minimumSize(node.second)[axis] / available;
    const ratio = Math.max(min, Math.min(max, node.ratio));
    const firstSize = Math.round(available * ratio);
    const secondStart = firstSize + DIVIDER_SIZE;
    const first = { ...rect, [axis]: firstSize };
    const second = horizontal
      ? {
          ...rect,
          left: rect.left + secondStart,
          width: rect.width - secondStart,
        }
      : {
          ...rect,
          top: rect.top + secondStart,
          height: rect.height - secondStart,
        };
    dividers.push({
      id: node.id,
      direction: node.direction,
      container: rect,
      ratio,
      min,
      max,
      primary: visibleSessions(node.first),
      ...(horizontal
        ? {
            left: rect.left + firstSize,
            top: rect.top,
            width: DIVIDER_SIZE,
            height: rect.height,
          }
        : {
            left: rect.left,
            top: rect.top + firstSize,
            width: rect.width,
            height: DIVIDER_SIZE,
          }),
    });
    visit(node.first, first);
    visit(node.second, second);
  };
  if (layout) {
    const minimum = minimumSize(layout);
    visit(layout, {
      left: 0,
      top: 0,
      width: Math.max(width, minimum.width),
      height: Math.max(height, minimum.height),
    });
  }
  return { panes, dividers };
}

export function adjacentPane(
  panes: Record<string, Rect>,
  active: string,
  direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): string | null {
  const current = panes[active];
  if (!current) return null;
  const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
  const reverse = direction === "ArrowLeft" || direction === "ArrowUp";
  const axisStart = (rect: Rect) => (horizontal ? rect.left : rect.top);
  const axisSize = (rect: Rect) => (horizontal ? rect.width : rect.height);
  const crossStart = (rect: Rect) => (horizontal ? rect.top : rect.left);
  const crossSize = (rect: Rect) => (horizontal ? rect.height : rect.width);
  const cross = crossStart(current) + crossSize(current) / 2;
  return (
    Object.entries(panes)
      .filter(
        ([id, rect]) =>
          id !== active &&
          (reverse
            ? axisStart(rect) + axisSize(rect) <= axisStart(current)
            : axisStart(rect) >= axisStart(current) + axisSize(current)),
      )
      .sort(([, a], [, b]) => {
        const score = (rect: Rect) => {
          const crossGap = Math.max(
            crossStart(rect) - cross,
            cross - crossStart(rect) - crossSize(rect),
            0,
          );
          const axisGap = reverse
            ? axisStart(current) - axisStart(rect) - axisSize(rect)
            : axisStart(rect) - axisStart(current) - axisSize(current);
          return (
            crossGap * 10000 +
            axisGap +
            Math.abs(crossStart(rect) + crossSize(rect) / 2 - cross)
          );
        };
        return score(a) - score(b);
      })[0]?.[0] ?? null
  );
}
