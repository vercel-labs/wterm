import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL_STATE, workspaceReducer } from "../lib/workspace-layout";
import { restoreLayout, serializeLayout } from "../lib/workspace-persistence";

test("layout decoding bounds the tree and rejects duplicate, dangling and malformed references", () => {
  let state = INITIAL_STATE;
  for (let i = 1; i <= 3; i++)
    state = workspaceReducer(state, {
      type: "split",
      id: `session-${i}`,
      direction: "right",
    });
  const ids = state.sessions.map((session) => session.id);
  const raw = serializeLayout(state);
  const saved = JSON.parse(raw);
  assert.deepEqual(restoreLayout(raw, ids)?.layout, state.layout);
  for (const change of [
    { version: 2 },
    { ids: [...ids].reverse() },
    { ids: ids.slice(1) },
    { activeId: "session-5" },
    { activeId: null },
    { zoomed: 1 },
    { nextNumber: 4 },
    { nextNumber: 1.5 },
    { nextNumber: 1e100 },
    { layout: null },
    { layout: { kind: "pane", session: "session-5" } },
    { layout: { ...saved.layout, ratio: -0.1 } },
    { layout: { ...saved.layout, ratio: 1.1 } },
    { layout: { ...saved.layout, ratio: null } },
    { layout: { ...saved.layout, direction: "up" } },
    { layout: { ...saved.layout, id: "split-5" } },
    { layout: { ...saved.layout, first: saved.layout.second } },
    {
      layout: {
        ...saved.layout,
        second: { ...saved.layout.second, id: saved.layout.id },
      },
    },
  ])
    assert.equal(
      restoreLayout(JSON.stringify({ ...saved, ...change }), ids),
      null,
      JSON.stringify(change),
    );
  const fifth = workspaceReducer(state, { type: "add" });
  const oversized = {
    ...saved,
    ids: fifth.sessions.map((session) => session.id),
    nextNumber: 6,
    layout: {
      kind: "split",
      id: "split-5",
      direction: "down",
      ratio: 0.5,
      first: saved.layout,
      second: { kind: "pane", session: "session-5" },
    },
  };
  assert.equal(restoreLayout(JSON.stringify(oversized), oversized.ids), null);
  let deep: unknown = { kind: "pane", session: "session-1" };
  for (let i = 1; i <= 20; i++)
    deep = {
      kind: "split",
      id: `split-${i}`,
      direction: "right",
      ratio: 0.5,
      first: deep,
      second: saved.layout.first,
    };
  assert.equal(
    restoreLayout(
      JSON.stringify({ ...saved, nextNumber: 21, layout: deep }),
      ids,
    ),
    null,
  );
  assert.equal(restoreLayout("null", ids), null);
  assert.equal(restoreLayout("{", ids), null);
  assert.equal(restoreLayout(null, ids), null);
});

test("active sessions must be visible and empty layouts cannot retain zoom or pane references", () => {
  const hidden = workspaceReducer(INITIAL_STATE, { type: "add" });
  const saved = JSON.parse(serializeLayout(hidden));
  const ids = hidden.sessions.map((session) => session.id);
  assert.equal(
    restoreLayout(JSON.stringify({ ...saved, activeId: "session-1" }), ids),
    null,
  );
  const empty = {
    ...saved,
    ids: [],
    activeId: null,
    layout: null,
    zoomed: false,
  };
  assert.equal(restoreLayout(JSON.stringify(empty), [])?.nextNumber, 3);
  for (const change of [
    { activeId: "session-1" },
    { layout: saved.layout },
    { zoomed: true },
  ])
    assert.equal(
      restoreLayout(JSON.stringify({ ...empty, ...change }), []),
      null,
    );
});
