import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, git, gitRaw } from "./helpers.mjs";
import { diffArgs, parseDiff, sideBySide, MAX_DIFF_LINES } from "../mods/git-graph/lib/diff.js";

const run = (root, args) => gitRaw(root, ...args).stdout;
const T = (o) => ({ root: "", on: null, commit: null, parent: null, path: "", from: null, area: null, ...o });

test("rename commit diff has no hunks", async () => {
  const root = await fixture();
  const c4 = git(root, "rev-parse", "HEAD");
  const t = T({ root, commit: c4, parent: git(root, "rev-parse", "HEAD~1"), path: "dir with space/a renamed.txt", from: "a.txt" });
  const raw = run(root, diffArgs(t));
  assert.ok(raw.includes("rename from a.txt"));
  const d = parseDiff(raw);
  assert.equal(d.binary, false);
  assert.equal(d.hunks.length, 0);
});

test("unstaged README has + line", async () => {
  const root = await fixture();
  const d = parseDiff(run(root, diffArgs(T({ root, path: "README", area: "unstaged" }))));
  assert.ok(d.hunks[0].lines.some((l) => l.kind === "+"));
});

test("staged diff args", () => {
  assert.deepEqual(diffArgs(T({ path: "x", area: "staged" })).slice(-6), ["diff", "--no-color", "--cached", "-M", "--", "x"]);
});

test("untracked all +", async () => {
  const root = await fixture();
  const a = diffArgs(T({ root, path: "untracked.txt", area: "untracked" }));
  const r = gitRaw(root, ...a);
  assert.equal(r.code, 1);
  const d = parseDiff(r.stdout);
  const ls = d.hunks.flatMap((h) => h.lines);
  assert.ok(ls.length > 0 && ls.every((l) => l.kind === "+"));
});

test("binary", async () => {
  const root = await fixture();
  const c3 = git(root, "rev-parse", "HEAD~1^1");
  const t = T({ root, commit: c3, parent: git(root, "rev-parse", "HEAD~1^1~1"), path: "bin.dat" });
  assert.equal(parseDiff(run(root, diffArgs(t))).binary, true);
});

test("root commit parent uses empty tree", () => {
  assert.ok(diffArgs(T({ commit: "abc", path: "p" })).includes("4b825dc642cb6eb9a060e54bf8d69288fbee4904"));
});

test("sideBySide pairing", () => {
  const L = (kind, text) => ({ kind, old: null, new: null, text });
  const all = sideBySide([{ header: "@@ -1 +1 @@", lines: [L("-", "a"), L("-", "b"), L("+", "c")] }]);
  assert.deepEqual(all[0], { left: null, right: null, header: "@@ -1 +1 @@" });
  const rows = all.filter((r) => r.left || r.right);
  assert.deepEqual(rows.map((r) => [r.left?.text, r.right?.text ?? null]), [["a", "c"], ["b", null]]);
});

test("line numbers and no-newline", () => {
  const d = parseDiff("@@ -3,2 +3,3 @@ f\n a\n-b\n+c\n+d\n\\ No newline at end of file\n");
  assert.deepEqual(d.hunks[0].lines.map((l) => [l.old, l.new]), [[3, 3], [4, null], [null, 4], [null, 5]]);
  assert.equal(d.truncated, false);
});

test("truncation", () => {
  const text = "@@ -1 +1 @@\n" + "+x\n".repeat(MAX_DIFF_LINES + 5);
  const d = parseDiff(text);
  assert.equal(d.truncated, true);
  assert.equal(d.hunks[0].lines.length, MAX_DIFF_LINES);
});

test("multi-file diff: later headers skipped, binary after hunk detected", () => {
  const two = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/y b/y\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-c\n+d\n";
  const d = parseDiff(two);
  assert.equal(d.hunks.length, 2);
  assert.deepEqual(d.hunks.map((h) => h.lines.map((l) => l.text)), [["a", "b"], ["c", "d"]]);
  const bin = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/z b/z\nBinary files a/z and b/z differ\n");
  assert.equal(bin.binary, true);
  assert.equal(bin.hunks[0].lines.length, 2);
});
