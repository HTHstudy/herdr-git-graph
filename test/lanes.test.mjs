import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, git } from "./helpers.mjs";
import { logArgs, stashArgs } from "../mods/git-graph/lib/git.js";
import { parseLog, parseStashes } from "../mods/git-graph/lib/parse.js";
import { layoutGraph, MAX_LANES } from "../mods/git-graph/lib/lanes.js";

const c = (hash, ...parents) => ({ hash, parents, author: "a", email: "e", date: "d", subject: hash });
const has = (row, half, from, to) => row.lines.some((l) => l.half === half && l.from === from && l.to === to);

test("linear history stays in lane 0", () => {
  const rows = layoutGraph([c("c3", "c2"), c("c2", "c1"), c("c1")], [], null, false);
  assert.deepEqual(rows.map((r) => r.lane), [0, 0, 0]);
  assert.equal(rows[1].lines.filter((l) => l.half === "top").length, 1);
  assert.equal(rows[1].lines.filter((l) => l.half === "bottom").length, 1);
  assert.ok(has(rows[1], "top", 0, 0) && has(rows[1], "bottom", 0, 0));
  assert.equal(rows[0].lines.filter((l) => l.half === "top").length, 0);
  assert.equal(rows[2].lines.filter((l) => l.half === "bottom").length, 0);
  assert.equal(rows[0].kind, "commit");
  assert.equal(rows[0].commit.hash, "c3");
});

test("merge commit opens lane 1 and B merges back", () => {
  const rows = layoutGraph([c("M", "A", "B"), c("B", "A"), c("A")], [], null, false);
  assert.equal(rows[0].lane, 0);
  assert.ok(has(rows[0], "bottom", 0, 0) && has(rows[0], "bottom", 0, 1));
  assert.equal(rows[1].lane, 1);
  assert.ok(has(rows[1], "top", 1, 1) && has(rows[1], "bottom", 1, 0));
  assert.ok(has(rows[1], "top", 0, 0) && has(rows[1], "bottom", 0, 0));
  assert.equal(rows[2].lane, 0);
  assert.ok(has(rows[2], "top", 0, 0));
  // colors: new lane 1 -> color 1; merge edge uses source lane color
  assert.equal(rows[1].color, 1);
  assert.equal(rows[2].color, 0);
  assert.equal(rows[0].lines.find((l) => l.to === 1).color, 1);
  assert.equal(rows[1].lines.find((l) => l.half === "bottom" && l.from === 1 && l.to === 0).color, 1);
});

test("stash sits directly above its base, in another lane", () => {
  const commits = [c("T", "B"), c("X", "B"), c("B", "R"), c("R")];
  // T and X are two heads; B has a child lane already
  const rows = layoutGraph(commits, [{ hash: "S", base: "B", selector: "stash@{0}", date: "d", subject: "s" }], null, false);
  const i = rows.findIndex((r) => r.kind === "stash");
  assert.equal(rows[i + 1].hash, "B");
  assert.notEqual(rows[i].lane, rows[i + 1].lane);
  assert.equal(rows[i].stash.hash, "S");
  // dangling stash dropped
  const r2 = layoutGraph(commits, [{ hash: "S", base: "nope", selector: "x", date: "d", subject: "s" }], null, false);
  assert.ok(!r2.some((r) => r.kind === "stash"));
});

test("uncommitted row first, line to HEAD lane", () => {
  const rows = layoutGraph([c("H", "P"), c("P")], [], "H", true);
  assert.equal(rows[0].kind, "uncommitted");
  assert.equal(rows[0].hash, "*");
  assert.equal(rows[0].lane, 0);
  assert.ok(has(rows[0], "bottom", 0, 0));
  assert.equal(rows[1].hash, "H");
  assert.ok(has(rows[1], "top", 0, 0));
});

test("lane cap with 20 parallel heads", () => {
  const heads = Array.from({ length: 20 }, (_, i) => c("h" + i, "root"));
  const rows = layoutGraph([...heads, c("root")], [], null, false);
  for (const r of rows) {
    assert.ok(r.lane < MAX_LANES);
    for (const l of r.lines) assert.ok(l.from < MAX_LANES && l.to < MAX_LANES);
  }
  assert.equal(rows.length, 21);
});

test("fixture: every commit once, lanes within cap", async () => {
  const dir = await fixture();
  const commits = parseLog(git(dir, ...logArgs({ branches: null, remotes: true, count: 300 })));
  const stashes = parseStashes(git(dir, ...stashArgs()));
  const rows = layoutGraph(commits, stashes, commits[0].hash, true);
  const seen = rows.filter((r) => r.kind === "commit").map((r) => r.hash);
  assert.equal(new Set(seen).size, commits.length);
  assert.equal(seen.length, commits.length);
  for (const r of rows) assert.ok(r.lane < MAX_LANES);
  const lane = (subj) => rows.find((r) => r.commit?.subject === subj).lane;
  for (const subj of ["rename", "Merge feature/x", "main work", "add a", "init"]) assert.equal(lane(subj), 0, subj);
});

test("first parent keeps its lane when another lane also expects it", () => {
  const rows = layoutGraph([c("M", "A", "X"), c("T", "A"), c("A"), c("X")], [], null, false);
  // M@0 -> A(lane0), X(lane1); T opens lane 2? T is new head: first free lane = 2
  const m = rows.find((r) => r.hash === "M"), a = rows.find((r) => r.hash === "A");
  assert.equal(m.lane, 0);
  assert.equal(a.lane, 0);
  const t = rows.find((r) => r.hash === "T");
  assert.ok(t.lane > 0);
});

test("stash on a tip without child lane gets its own lane", () => {
  const S = { hash: "S", base: "B", selector: "stash@{0}", date: "d", subject: "s" };
  const rows = layoutGraph([c("B", "R"), c("R")], [S], null, false);
  assert.equal(rows[0].kind, "stash");
  assert.equal(rows[1].hash, "B");
  assert.equal(rows[1].lane, 0);
  assert.notEqual(rows[0].lane, 0);
  assert.ok(has(rows[0], "bottom", rows[0].lane, 0));
  assert.ok(!has(rows[0], "bottom", 0, 0));
  assert.ok(has(rows[1], "top", 0, 0));
});

test("stash with uncommitted row on another head keeps base's natural lane", () => {
  const S = { hash: "S", base: "B", selector: "stash@{0}", date: "d", subject: "s" };
  const rows = layoutGraph([c("H", "R"), c("B", "R"), c("R")], [S], "H", true);
  const si = rows.findIndex((r) => r.kind === "stash");
  const b = rows[si + 1];
  assert.equal(b.hash, "B");
  assert.notEqual(rows[si].lane, b.lane);
  assert.equal(rows.find((r) => r.hash === "H").lane, 0);
  assert.equal(b.lane, 1);
});
