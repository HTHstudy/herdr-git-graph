import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCwd } from "../mods/git-graph/lib/location.js";

const space = { id: "s1", active: true, folder: "/gone", machine: null };
const term = { pane: "p1", tab: "t1", cwd: "/repo", terminal: "x1" };
const diff = { pane: "p2", tab: "t1", cwd: null, terminal: null, mod: "git-graph" };

test("pickCwd: focused terminal pane uses its folder", () => {
  assert.equal(pickCwd({ space, focused: { pane: "p1", tab: "t1" }, panes: [term, diff] }), "/repo");
});

test("pickCwd: focused mod pane (no cwd) falls back to a terminal in the same tab, not the space folder", () => {
  assert.equal(pickCwd({ space, focused: { pane: "p2", tab: "t1" }, panes: [term, diff] }), "/repo");
});

test("pickCwd: terminal of another tab is not used", () => {
  const other = { ...term, tab: "t9" };
  assert.equal(pickCwd({ space, focused: { pane: "p2", tab: "t1" }, panes: [other, diff] }), "/gone");
});

test("pickCwd: layout terminal block (pane null) uses focused cwd", () => {
  assert.equal(pickCwd({ space, focused: { pane: null, tab: "t1", cwd: "/block" }, panes: [term] }), "/block");
});
