import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, git, gitRaw } from "./helpers.mjs";
import { diffArgs } from "../mods/git-graph/lib/diff.js";
import {
  sameTarget, targetLabel, absPath, deletesFile, diffOutcome, diffRows, gutterDigits,
  diffPaneOf, newDiffPane, gitGraphPanes,
} from "../mods/git-graph/lib/diffview.js";

const T = (o) => ({ root: "/r", on: null, commit: null, parent: null, path: "f", from: null, area: null, ...o });
const L = (kind, old, nw, text) => ({ kind, old, new: nw, text });

test("sameTarget compares every field, null-safe", () => {
  assert.ok(sameTarget(T({}), T({})));
  assert.ok(sameTarget(null, undefined));
  assert.ok(!sameTarget(T({}), null));
  assert.ok(!sameTarget(T({ area: "staged" }), T({ area: "unstaged" })));
  assert.ok(!sameTarget(T({ commit: "a" }), T({ commit: "b" })));
  assert.ok(sameTarget(T({ from: undefined }), T({ from: null })));
});

test("targetLabel: short hash or working tree area", () => {
  assert.equal(targetLabel(T({ commit: "0123456789abcdef" })), "0123456");
  assert.equal(targetLabel(T({ area: "untracked" })), "Working tree (untracked)");
});

test("absPath joins root and path", () => {
  assert.equal(absPath(T({ root: "/a/b/", path: "dir with space/x.txt" })), "/a/b/dir with space/x.txt");
});

test("deletesFile spots deletions", () => {
  assert.ok(deletesFile("diff --git a/x b/x\ndeleted file mode 100644\n--- a/x\n+++ /dev/null\n"));
  assert.ok(!deletesFile("diff --git a/x b/x\n--- a/x\n+++ b/x\n"));
});

test("diffOutcome: empty output is gone, untracked exit 1 is fine, errors kept", () => {
  assert.equal(diffOutcome(T({ commit: "a" }), { code: 0, stdout: "", stderr: "" }).state, "gone");
  const u = diffOutcome(T({ area: "untracked" }), { code: 1, stdout: "diff --git a/f b/f\n@@ -0,0 +1 @@\n+x\n", stderr: "" });
  assert.equal(u.state, "ready");
  assert.equal(u.diff.hunks[0].lines[0].text, "x");
  assert.equal(diffOutcome(T({ area: "untracked" }), { code: 128, stdout: "", stderr: "error: Could not access 'f'" }).state, "gone");
  const e = diffOutcome(T({ area: "unstaged" }), { code: 128, stdout: "", stderr: "fatal: bad\n" });
  assert.deepEqual(e, { state: "error", error: "fatal: bad" });
});

const D = {
  binary: false, truncated: false,
  hunks: [{ header: "@@ -1,2 +1,2 @@", lines: [L(" ", 1, 1, "a\tb"), L("-", 2, null, "old"), L("+", null, 2, "new")] }],
};

test("diffRows unified: hunk header then lines, tabs expanded, unique keys", () => {
  const rows = diffRows(D, "unified");
  assert.deepEqual(rows.map((r) => r.type), ["hunk", "line", "line", "line"]);
  assert.equal(rows[1].line.text, "a    b");
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
});

test("diffRows split: pairs from sideBySide", () => {
  const rows = diffRows(D, "split");
  assert.deepEqual(rows.map((r) => r.type), ["hunk", "pair", "pair"]);
  assert.equal(rows[2].left.text, "old");
  assert.equal(rows[2].right.text, "new");
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
});

test("diffRows notices: binary, no hunks, rename, truncated", () => {
  assert.deepEqual(diffRows({ binary: true, hunks: [], truncated: false }, "unified").map((r) => r.text), ["Binary file · no diff"]);
  assert.equal(diffRows({ binary: false, hunks: [], truncated: false }, "split")[0].text, "No content changes");
  assert.match(diffRows({ binary: false, hunks: [], truncated: false }, "unified", "a.txt")[0].text, /Renamed from a\.txt/);
  const t = diffRows({ ...D, truncated: true }, "unified");
  assert.equal(t.at(-1).type, "notice");
});

test("gutterDigits", () => {
  assert.equal(gutterDigits(D), 3);
  assert.equal(gutterDigits({ hunks: [{ lines: [L("+", null, 12345, "")] }] }), 5);
});

test("diff pane bookkeeping", () => {
  const list = [
    { pane: "p1", mod: "git-graph", tab: "t1" },
    { pane: "p2", mod: undefined, tab: "t1" },
    { pane: "p3", mod: "git-graph", tab: "t2" },
  ];
  assert.equal(diffPaneOf(list, "t1", "p1"), "p1");
  assert.equal(diffPaneOf(list, "t1", "p3"), null); // another tab's
  assert.equal(diffPaneOf(list, "t1", "gone"), null);
  assert.equal(diffPaneOf(list, "t1", null), null);
  assert.deepEqual(gitGraphPanes(list, "t1"), ["p1"]);
  assert.equal(newDiffPane(list, "t1", ["p1"]), null);
  assert.equal(newDiffPane([...list, { pane: "p4", mod: "git-graph", tab: "t1" }], "t1", ["p1"]), "p4");
});

test("fixture: commit diff of a path not in that commit is gone; rename has no hunks", async () => {
  const root = await fixture();
  const head = git(root, "rev-parse", "HEAD"), parent = git(root, "rev-parse", "HEAD~1");
  const raw = (t) => { const r = gitRaw(root, ...diffArgs(t)); return { code: r.code, stdout: r.stdout, stderr: "" }; };
  const gone = diffOutcome(T({ root, commit: head, parent, path: "no such file" }), raw(T({ root, commit: head, parent, path: "no such file" })));
  assert.equal(gone.state, "gone");
  const t = T({ root, commit: head, parent, path: "dir with space/a renamed.txt", from: "a.txt" });
  const ren = diffOutcome(t, raw(t));
  assert.equal(ren.state, "ready");
  assert.match(diffRows(ren.diff, "unified", t.from)[0].text, /Renamed from a\.txt/);
});
