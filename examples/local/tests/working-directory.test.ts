import assert from "node:assert/strict";
import test from "node:test";
import { reportedDirectory } from "../lib/working-directory";
import {
  INITIAL_STATE,
  workspaceReducer as reduce,
} from "../lib/workspace-layout";

test("directory labels retain the reported host and decode paths without resolving dot segments", () => {
  for (const [uri, expected] of [
    ["", null],
    ["file:///", "/"],
    [
      "file://build-box/home/me/project%20name",
      "build-box:/home/me/project name",
    ],
    ["file://localhost/tmp", "localhost:/tmp"],
    ["file://[::1]/tmp", "[::1]:/tmp"],
    ["file:///tmp/%E6%97%A5%E6%9C%AC", "/tmp/日本"],
    ["file:///tmp/link/../project/", "/tmp/link/../project/"],
    ["file:///tmp/%23%3F%25%5C", "/tmp/#?%\\"],
  ] as const)
    assert.equal(reportedDirectory(uri), expected);
});

test("invalid, oversized, control-bearing, and non-file reports cannot replace a displayed directory", () => {
  for (const uri of [
    "https://host/tmp",
    "file:/tmp",
    "file://host",
    "file://user@host/tmp",
    "file://host:22/tmp",
    "file://[bad]/tmp",
    "file://host/tmp?query",
    "file://host/tmp#fragment",
    "file:///tmp\\fake",
    "file:///tmp/%",
    "file:///tmp/%FF",
    "file:///tmp/%00",
    "file:///tmp/%0A",
    "file:///tmp/%C2%85",
    "file:///tmp/%E2%80%AEevil",
    "file:///tmp\nother",
    "file://" + "a".repeat(256) + "/tmp",
    "file:///" + "x".repeat(2047),
  ])
    assert.equal(reportedDirectory(uri), undefined, uri);
});

test("shell reports stay with their session while process updates remain available for reset", () => {
  let state = reduce(INITIAL_STATE, { type: "add" });
  state = reduce(state, {
    type: "directory",
    id: "session-1",
    uri: "file://remote/work",
  });
  state = reduce(state, { type: "cwd", id: "session-1", cwd: "/latest/local" });
  assert.equal(state.sessions[0].reportedCwd, "remote:/work");
  assert.equal(state.sessions[0].cwd, "/latest/local");
  assert.equal(state.sessions[1].reportedCwd, null);
  assert.equal(state.activeId, "session-2");
  for (const uri of ["file://remote/work", "https://remote/work"])
    assert.equal(
      reduce(state, { type: "directory", id: "session-1", uri }),
      state,
    );
  state = reduce(state, { type: "directory", id: "session-1", uri: "" });
  assert.equal(state.sessions[0].reportedCwd, null);
  assert.equal(state.sessions[0].cwd, "/latest/local");
});
