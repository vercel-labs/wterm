import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_STATE,
  adjacentPane,
  measureLayout,
  minimumSize,
  visibleSessions,
  workspaceReducer as reduce,
  shellLabel,
} from "../lib/workspace-layout";

const split = () =>
  reduce(INITIAL_STATE, { type: "split", id: "session-1", direction: "right" });

test("shell state stays with its session and is hidden while its connection is unavailable", () => {
  let state = reduce(split(), {
    type: "status",
    id: "session-1",
    status: "connected",
  });
  const shell = { phase: "running" as const, exitCode: null };
  state = reduce(state, { type: "shell", id: "session-1", shell });
  assert.equal(shellLabel(state.sessions[0]), "Running");
  assert.equal(shellLabel(state.sessions[1]), null);
  assert.equal(state.activeId, "session-2");
  assert.equal(reduce(state, { type: "shell", id: "session-1", shell }), state);
  assert.equal(reduce(state, { type: "shell", id: "closed", shell }), state);
  state = reduce(state, {
    type: "shell",
    id: "session-1",
    shell: { phase: "input", exitCode: 7 },
  });
  assert.equal(shellLabel(state.sessions[0]), "Exit 7");
  state = reduce(state, {
    type: "status",
    id: "session-1",
    status: "reconnecting",
  });
  assert.equal(shellLabel(state.sessions[0]), null);
  state = reduce(state, {
    type: "status",
    id: "session-1",
    status: "connected",
  });
  assert.equal(shellLabel(state.sessions[0]), "Exit 7");
  state = reduce(state, {
    type: "shell",
    id: "session-1",
    shell: { phase: "unknown", exitCode: null },
  });
  assert.equal(shellLabel(state.sessions[0]), null);
});

test("splitting and selecting never duplicate a session or replace its metadata", () => {
  let state = reduce(INITIAL_STATE, {
    type: "cwd",
    id: "session-1",
    cwd: "/work",
  });
  state = reduce(state, { type: "split", id: "session-1", direction: "right" });
  assert.deepEqual(visibleSessions(state.layout), ["session-1", "session-2"]);
  assert.equal(state.sessions[0].cwd, "/work");
  assert.equal(state.activeId, "session-2");
  const tree = state.layout;
  const request = state.sessions[0].focusRequest;
  state = reduce(state, { type: "focus", id: "session-1" });
  assert.equal(
    state.sessions[0].focusRequest,
    request,
    "pointer/focus activation must not move focus",
  );
  state = reduce(state, { type: "select", id: "session-1" });
  assert.equal(state.sessions[0].focusRequest, request + 1);
  assert.equal(
    state.layout,
    tree,
    "selecting a visible session only focuses it",
  );
  state = reduce(state, { type: "add" });
  assert.deepEqual(visibleSessions(state.layout), ["session-3", "session-2"]);
  state = reduce(state, { type: "select", id: "session-1" });
  assert.deepEqual(visibleSessions(state.layout), ["session-1", "session-2"]);
  assert.equal(state.sessions.length, 3);
  assert.equal(state.sessions[0].cwd, "/work");
});

test("closing a pane collapses its split and leaves surviving session identities intact", () => {
  let state = reduce(split(), {
    type: "split",
    id: "session-2",
    direction: "down",
  });
  const first = state.sessions[0];
  state = reduce(state, { type: "close", id: "session-3" });
  assert.deepEqual(visibleSessions(state.layout), ["session-1", "session-2"]);
  assert.equal(state.activeId, "session-2");
  assert.equal(state.sessions[0], first);
  state = reduce(state, { type: "close", id: "session-1" });
  assert.deepEqual(state.layout, { kind: "pane", session: "session-2" });
  state = reduce(state, { type: "add" });
  state = reduce(state, { type: "close", id: "session-4" });
  assert.equal(
    state.activeId,
    "session-2",
    "closing the last visible pane reveals a retained session",
  );
  state = reduce(state, { type: "close", id: "session-2" });
  assert.equal(state.layout, null);
  assert.equal(state.activeId, null);
  state = reduce(state, { type: "add" });
  assert.equal(state.activeId, "session-5", "closed IDs are not reused");
});

test("zooming retains the layout and invalid actions cannot grow it", () => {
  let state = split();
  state = reduce(state, { type: "split", id: "session-2", direction: "down" });
  state = reduce(state, { type: "split", id: "session-1", direction: "down" });
  assert.equal(visibleSessions(state.layout).length, 4);
  for (const action of [
    { type: "split", id: "session-1", direction: "right" },
    { type: "split", id: "missing", direction: "right" },
    { type: "select", id: "missing" },
    { type: "resize", id: "split-2", ratio: NaN },
  ] as const)
    assert.equal(reduce(state, action), state);
  state = reduce(state, { type: "zoom", id: "session-2" });
  assert.equal(state.zoomed, true);
  assert.equal(visibleSessions(state.layout).length, 4);
  const splitLayout = state.layout;
  state = reduce(state, { type: "zoom", id: "session-2" });
  assert.equal(state.zoomed, false);
  assert.equal(state.layout, splitLayout);
  assert.equal(state.sessions.length, 4);
  state = reduce(state, { type: "close", id: "session-1" });
  assert.equal(visibleSessions(state.layout).length, 3);
  assert.equal(state.activeId, "session-2");
});

test("nested geometry fits its canvas and clamps every pane to its minimum", () => {
  let state = reduce(split(), {
    type: "split",
    id: "session-2",
    direction: "down",
  });
  state = reduce(state, { type: "split", id: "session-1", direction: "right" });
  state = reduce(state, { type: "resize", id: "split-2", ratio: 0 });
  state = reduce(state, { type: "resize", id: "split-3", ratio: 1 });
  for (const [width, height] of [
    [0, 0],
    [1600, 1000],
    [900, 600],
  ]) {
    const minimum = minimumSize(state.layout);
    const measured = measureLayout(state.layout, width, height);
    const rects = Object.values(measured.panes);
    assert.equal(rects.length, 4);
    assert.equal(measured.dividers.length, 3);
    for (const rect of rects) {
      assert.ok(rect.width >= 320 && rect.height >= 220);
      assert.ok(rect.left >= 0 && rect.top >= 0);
      assert.ok(rect.left + rect.width <= Math.max(width, minimum.width));
      assert.ok(rect.top + rect.height <= Math.max(height, minimum.height));
      for (const other of rects) {
        if (rect === other) continue;
        assert.ok(
          rect.left >= other.left + other.width ||
            other.left >= rect.left + rect.width ||
            rect.top >= other.top + other.height ||
            other.top >= rect.top + rect.height,
        );
      }
    }
  }
});

test("directional focus follows adjacent panes, without wrapping at outside edges", () => {
  const state = reduce(split(), {
    type: "split",
    id: "session-2",
    direction: "down",
  });
  const { panes } = measureLayout(state.layout, 1000, 800);
  assert.equal(adjacentPane(panes, "session-2", "ArrowDown"), "session-3");
  assert.equal(adjacentPane(panes, "session-3", "ArrowUp"), "session-2");
  assert.equal(adjacentPane(panes, "session-3", "ArrowLeft"), "session-1");
  assert.equal(adjacentPane(panes, "session-1", "ArrowRight"), "session-2");
  assert.equal(adjacentPane(panes, "session-1", "ArrowDown"), null);
  assert.equal(adjacentPane(panes, "session-2", "ArrowRight"), null);
});

test("closing a nested pane focuses the sibling that fills its space", () => {
  let state = reduce(split(), {
    type: "split",
    id: "session-1",
    direction: "down",
  });
  assert.equal(state.activeId, "session-3");
  state = reduce(state, { type: "close", id: "session-3" });
  assert.equal(state.activeId, "session-1");
  state = reduce(state, { type: "split", id: "session-1", direction: "down" });
  state = reduce(state, { type: "select", id: "session-1" });
  state = reduce(state, { type: "close", id: "session-1" });
  assert.equal(state.activeId, "session-4");
});
