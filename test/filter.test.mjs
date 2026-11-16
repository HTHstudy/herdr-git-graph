import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, git } from "./helpers.mjs";
import { logArgs, refsArgs, stashArgs } from "../mods/git-graph/lib/git.js";
import { parseLog, parseRefs, parseStashes } from "../mods/git-graph/lib/parse.js";
import { layoutGraph } from "../mods/git-graph/lib/lanes.js";
import { refChips } from "../mods/git-graph/lib/format.js";
import {
  toggleBranch, removeBranch, showUncommitted, pruneFilter, shortRef, branchEntries, filterLabel, findMatches, stepMatch, matchCount,
} from "../mods/git-graph/lib/filter.js";

const subjects = (out) => parseLog(out).map((c) => c.subject);

test("logArgs ends revisions with -- and lists exactly the given refs", async () => {
  const d = await fixture();
  const all = logArgs({ branches: null, remotes: true, count: 300 });
  assert.equal(all.at(-1), "--");
  // A file named like the branch must not make the revision ambiguous.
  writeFileSync(join(d, "topic"), "x\n");
  const args = logArgs({ branches: ["refs/heads/topic"], remotes: true, count: 300 });
  assert.equal(args.at(-1), "--");
  assert.deepEqual(subjects(git(d, ...args)), ["topic 1", "main work", "add a", "init"]);
  // Two refs, local and remote.
  const two = subjects(git(d, ...logArgs({ branches: ["refs/heads/topic", "refs/remotes/origin/remote-only"], remotes: true, count: 300 })));
  assert.ok(two.includes("topic 1") && two.includes("remote only") && !two.includes("feat x 1"));
  // A deleted branch is skipped instead of failing the load.
  assert.deepEqual(subjects(git(d, ...logArgs({ branches: ["refs/heads/gone", "refs/heads/topic"], remotes: true, count: 300 }))).length, 4);
  assert.deepEqual(subjects(git(d, ...logArgs({ branches: ["refs/heads/gone"], remotes: true, count: 300 }))), []);
  // An empty list is Show All.
  assert.deepEqual(logArgs({ branches: [], remotes: false, count: 5 }), logArgs({ branches: null, remotes: false, count: 5 }));
});

test("toggleBranch / removeBranch keep null for Show All", () => {
  assert.deepEqual(toggleBranch(null, "refs/heads/a"), ["refs/heads/a"]);
  assert.deepEqual(toggleBranch(["refs/heads/a"], "refs/heads/b"), ["refs/heads/a", "refs/heads/b"]);
  assert.equal(toggleBranch(["refs/heads/a"], "refs/heads/a"), null);
  assert.equal(removeBranch(null, "a"), null);
  assert.deepEqual(removeBranch(["refs/heads/a", "refs/remotes/origin/a"], "a"), ["refs/remotes/origin/a"]);
  assert.deepEqual(removeBranch(["refs/heads/a", "refs/remotes/origin/a"], "origin/a"), ["refs/heads/a"]);
  assert.equal(removeBranch(["refs/heads/a"], "refs/heads/a"), null);
  assert.equal(shortRef("refs/remotes/origin/x/y"), "origin/x/y");
});

test("pruneFilter drops vanished refs and hidden remotes", () => {
  const refs = [{ name: "refs/heads/a", kind: "head" }, { name: "refs/remotes/origin/a", kind: "remote" }];
  const f = ["refs/heads/a", "refs/remotes/origin/a"];
  assert.equal(pruneFilter(f, refs, true), f); // unchanged: same array
  assert.deepEqual(pruneFilter(f, refs, false), ["refs/heads/a"]);
  assert.equal(pruneFilter(["refs/heads/gone"], refs, true), null);
  assert.equal(pruneFilter(null, refs, true), null);
});

test("branchEntries lists locals then remotes (when shown), checked from the filter", async () => {
  const d = await fixture();
  const refs = parseRefs(git(d, ...refsArgs()));
  const e = branchEntries(refs, ["refs/heads/topic"], true);
  assert.deepEqual(e.filter((x) => x.kind === "head").map((x) => x.label), ["feature/x", "main", "topic"]);
  assert.ok(e.some((x) => x.kind === "remote" && x.label === "origin/remote-only"));
  assert.ok(!e.some((x) => x.label.endsWith("HEAD") || x.label.startsWith("v1")));
  assert.deepEqual(e.filter((x) => x.checked).map((x) => x.name), ["refs/heads/topic"]);
  assert.ok(branchEntries(refs, null, false).every((x) => x.kind === "head" && !x.checked));
  assert.equal(filterLabel(null), "Show All");
  assert.equal(filterLabel(["refs/remotes/origin/x"]), "origin/x");
  assert.equal(filterLabel(["refs/heads/a", "refs/heads/b"]), "2 branches");
});

test("findMatches: subject, author, hash prefix, ref names — case-insensitive, row order", async () => {
  const d = await fixture();
  const commits = parseLog(git(d, ...logArgs({ branches: null, remotes: true, count: 300 })));
  const stashes = parseStashes(git(d, ...stashArgs()));
  const refs = parseRefs(git(d, ...refsArgs()));
  const head = git(d, "rev-parse", "HEAD");
  const rows = layoutGraph(commits, stashes, head, true);
  const chips = refChips(refs, "main", head, ["origin"]);
  const subj = (hs) => hs.map((h) => rows.find((r) => r.hash === h)).map((r) => r.commit?.subject ?? r.stash.subject);
  assert.deepEqual(subj(findMatches(rows, chips, "FEAT")), ["Merge feature/x", "feat x 2", "feat x 1"]);
  assert.deepEqual(subj(findMatches(rows, chips, "v1.1")), ["Merge feature/x"]); // tag chip
  assert.deepEqual(subj(findMatches(rows, chips, "remote-only")), ["remote only"]); // remote chip
  // A remote branch paired into its local chip is still found by its full name.
  const paired = [...chips.values()].flat().find((c) => c.remotes?.length);
  assert.ok(paired, "the fixture pairs topic and feature/x");
  assert.ok(findMatches(rows, chips, paired.remotes[0].ref.short).includes(paired.ref.hash));
  assert.deepEqual(subj(findMatches(rows, chips, "wip")), ["On main: wip stash"]);
  const init = commits.find((c) => c.subject === "init").hash;
  assert.deepEqual(findMatches(rows, chips, init.slice(0, 6).toUpperCase()), [init]);
  assert.ok(!findMatches(rows, chips, init.slice(1, 7)).includes(init)); // prefix only
  assert.equal(findMatches(rows, chips, "test").length, commits.length); // author
  assert.deepEqual(findMatches(rows, chips, "   "), []);
  assert.deepEqual(findMatches(rows, chips, "uncommitted"), []);
});

test("stepMatch wraps both ways; matchCount shows n/m", () => {
  const m = ["a", "b", "c"];
  assert.equal(stepMatch(m, null, 1), "a");
  assert.equal(stepMatch(m, null, -1), "c");
  assert.equal(stepMatch(m, "c", 1), "a");
  assert.equal(stepMatch(m, "a", -1), "c");
  assert.equal(stepMatch(m, "b", 1), "c");
  assert.equal(stepMatch(m, "gone", 1), "a");
  assert.equal(stepMatch([], "a", 1), null);
  assert.equal(matchCount(m, "b"), "2/3");
  assert.equal(matchCount(m, null), "0/3");
  assert.equal(matchCount([], null), "0/0");
});

test("a branch filter without HEAD drops the Uncommitted row and its false lane", async () => {
  const d = await fixture(); // dirty tree, HEAD = main
  const head = git(d, "rev-parse", "HEAD");
  const filter = ["refs/heads/topic"];
  const commits = parseLog(git(d, ...logArgs({ branches: filter, remotes: true, count: 300 })));
  assert.ok(!commits.some((c) => c.hash === head));
  const show = showUncommitted(true, filter, commits, head);
  assert.equal(show, false);
  const rows = layoutGraph(commits, [], head, show);
  assert.ok(!rows.some((r) => r.kind === "uncommitted"));
  const clean = layoutGraph(commits, [], head, false);
  const maxLane = (rs) => Math.max(...rs.flatMap((r) => [r.lane, ...r.lines.flatMap((l) => [l.from, l.to])]));
  assert.equal(maxLane(rows), maxLane(clean));
  assert.equal(maxLane(rows), 0); // topic's history is linear
  // HEAD loaded (filter includes main) or Show All: the row stays.
  const withMain = parseLog(git(d, ...logArgs({ branches: ["refs/heads/main"], remotes: true, count: 300 })));
  assert.equal(showUncommitted(true, ["refs/heads/main"], withMain, head), true);
  assert.equal(showUncommitted(true, null, [], head), true);
  assert.equal(showUncommitted(false, null, withMain, head), false);
});
