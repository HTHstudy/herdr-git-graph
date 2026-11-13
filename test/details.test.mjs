import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, git } from "./helpers.mjs";
import { commitFilesArgs, commitStatusArgs, statusArgs, READ } from "../mods/git-graph/lib/git.js";
import { parseNumstat, parseNameStatus, parseStatus } from "../mods/git-graph/lib/parse.js";
import {
  commitFiles, fileCounts, absoluteDate, bodyLines, commitTarget, uncommittedTarget,
  uncommittedGroups, detailItems, throughLanes, pruneState, LINE, TEXT, PAD, MAX_BODY,
} from "../mods/git-graph/lib/details.js";

const byMsg = (dir, msg) => git(dir, "log", "--all", "--format=%H", `--grep=^${msg}$`, "-n1");

test("commitStatusArgs", () => {
  assert.deepEqual(commitStatusArgs("h", null), [...READ, "diff-tree", "--root", "--name-status", "-z", "-M", "-r", "h"]);
  assert.deepEqual(commitStatusArgs("h", "p"), [...READ, "diff", "--name-status", "-z", "-M", "p", "h"]);
});

test("parseNameStatus + commitFiles on the fixture", async () => {
  const d = await fixture();
  const files = (h, p) => commitFiles(parseNumstat(git(d, ...commitFilesArgs(h, p))), parseNameStatus(git(d, ...commitStatusArgs(h, p))));
  const c4 = git(d, "rev-parse", "HEAD");
  assert.deepEqual(files(c4, git(d, "rev-parse", "HEAD~1")),
    [{ path: "dir with space/a renamed.txt", from: "a.txt", added: 0, deleted: 0, status: "R" }]);
  const c3 = byMsg(d, "main work");
  const f3 = files(c3, git(d, "rev-parse", c3 + "^"));
  assert.deepEqual(f3.map((f) => [f.path, f.status, fileCounts(f)]), [["bin.dat", "A", "bin"], ["work.txt", "A", "+1 \u22120"]]);
  const root = git(d, "rev-list", "--max-parents=0", "HEAD");
  assert.deepEqual(files(root, null).map((f) => [f.path, f.status]), [["README", "A"]]);
  // a merge against its first parent
  const m = byMsg(d, "Merge feature/x");
  assert.deepEqual(files(m, git(d, "rev-parse", m + "^1")).map((f) => [f.path, f.status, fileCounts(f)]), [["x.txt", "A", "+2 \u22120"]]);
});

test("parseNameStatus copies and deletions", () => {
  assert.deepEqual(parseNameStatus("abc123\0D\0gone\0C075\0src\0dst\0M\0x\0"), [
    { path: "gone", from: null, status: "D" },
    { path: "dst", from: "src", status: "C" },
    { path: "x", from: null, status: "M" },
  ]);
});

test("commitFiles falls back to M / R", () => {
  const out = commitFiles([{ path: "a", from: null, added: 1, deleted: 2 }, { path: "b", from: "c", added: 0, deleted: 0 }], []);
  assert.deepEqual(out.map((f) => f.status), ["M", "R"]);
  assert.equal(fileCounts(out[0]), "+1 \u22122");
});

test("absoluteDate", () => {
  assert.equal(absoluteDate(0, 0), "1970-01-01 00:00:00 +0000");
  assert.equal(absoluteDate(1_700_000_000, 540), "2023-11-15 07:13:20 +0900");
  assert.equal(absoluteDate(1_700_000_000, -330), "2023-11-14 16:43:20 -0530");
  assert.match(absoluteDate(1_700_000_000), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4}$/);
  assert.equal(absoluteDate(NaN), "");
});

test("bodyLines", () => {
  assert.deepEqual(bodyLines("subj\n\n\tbody  \n\n"), ["subj", "", "    body"]);
  assert.deepEqual(bodyLines(""), []);
  const long = bodyLines(Array.from({ length: MAX_BODY + 5 }, (_, i) => `l${i}`).join("\n"));
  assert.equal(long.length, MAX_BODY + 1);
  assert.equal(long.at(-1), "…");
});

test("diff targets", () => {
  assert.deepEqual(commitTarget("/r", null, "h", "p", { path: "b", from: "a" }),
    { root: "/r", on: null, commit: "h", parent: "p", path: "b", from: "a", area: null });
  assert.deepEqual(commitTarget("/r", "m", "h", undefined, { path: "b" }),
    { root: "/r", on: "m", commit: "h", parent: null, path: "b", from: null, area: null });
  for (const area of ["staged", "unstaged", "untracked"]) {
    assert.deepEqual(uncommittedTarget("/r", null, { path: "p", from: "o", status: "R", area, conflict: false }),
      { root: "/r", on: null, commit: null, parent: null, path: "p", from: area === "staged" ? "o" : null, area });
  }
});

test("uncommittedGroups on the fixture", async () => {
  const d = await fixture();
  const g = uncommittedGroups(parseStatus(git(d, ...statusArgs())));
  assert.deepEqual(g.staged.map((f) => [f.path, f.status, f.area]), [["staged.txt", "A", "staged"]]);
  assert.deepEqual(g.changes.map((f) => [f.path, f.status, f.area]).sort(),
    [["README", "M", "unstaged"], ["untracked.txt", "U", "untracked"]]);
});

test("uncommittedGroups: both sides, conflicts", () => {
  const e = (o) => ({ path: "f", from: null, staged: null, unstaged: null, untracked: false, conflict: false, ...o });
  const g = uncommittedGroups([e({ staged: "M", unstaged: "M" }), e({ path: "c", staged: "U", unstaged: "U", conflict: true }),
    e({ path: "n", staged: "R", from: "o" })]);
  assert.deepEqual(g.staged.map((f) => [f.path, f.status, f.from]), [["f", "M", null], ["n", "R", "o"]]);
  assert.deepEqual(g.changes.map((f) => [f.path, f.status, f.conflict, f.area]), [["f", "M", false, "unstaged"], ["c", "U", true, "unstaged"]]);
});

test("detailItems", () => {
  const row = { kind: "commit", hash: "h" };
  assert.deepEqual(detailItems(row, null, []).map((i) => i.key), ["d:h:loading", "d:h:end"]);
  assert.equal(detailItems(row, { state: "error", error: "boom" }, [])[0].text, "boom");
  const info = { hash: "h", parents: ["p1", "p2"], body: "Merge x\n\nmore", author: "A" };
  const items = detailItems(row, { state: "ready", info, files: [{ path: "a", from: null, added: 1, deleted: 0, status: "A" }], parent: "p1" }, []);
  assert.deepEqual(items.map((i) => i.key),
    ["d:h:hash", "d:h:parent:0", "d:h:parent:1", "d:h:meta", "d:h:body", "d:h:files", "d:h:file:0", "d:h:end"]);
  assert.equal(items.find((i) => i.part === "body").size, 3 * TEXT + 2 * PAD);
  assert.equal(items.find((i) => i.part === "group").title, "1 file changed");
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
  const u = detailItems({ kind: "uncommitted", hash: "*" }, null,
    [{ path: "s", from: null, staged: "A", unstaged: null, untracked: false, conflict: false },
     { path: "u", from: null, staged: null, unstaged: null, untracked: true, conflict: false }]);
  assert.deepEqual(u.map((i) => [i.key, i.size]),
    [["d:*:staged", LINE], ["d:*:staged:0", LINE], ["d:*:changes", LINE], ["d:*:changes:0", LINE], ["d:*:end", PAD]]);
  assert.equal(u[0].title, "Staged (1)");
  assert.equal(detailItems({ kind: "uncommitted", hash: "*" }, null, [])[0].text, "No changes");
});

test("throughLanes: bottom lines' end lanes, deduped, on every detail item", () => {
  const row = { kind: "commit", hash: "h", lines: [
    { from: 0, to: 0, color: 0, half: "top" }, { from: 0, to: 0, color: 0, half: "bottom" },
    { from: 0, to: 1, color: 2, half: "bottom" }, { from: 1, to: 1, color: 2, half: "bottom" }, { from: 3, to: 2, color: 4, half: "bottom" },
  ] };
  assert.deepEqual(throughLanes(row), [{ x: 0, color: 0 }, { x: 1, color: 2 }, { x: 2, color: 4 }]);
  assert.deepEqual(throughLanes({ lines: [{ from: 0, to: 0, color: 0, half: "top" }] }), []);
  for (const it of detailItems(row, null, [])) assert.deepEqual(it.lanes, throughLanes(row));
});

test("pruneState drops hashes no longer shown", () => {
  const rows = [{ hash: "a" }, { hash: "b" }];
  const s = { expanded: "*", selected: "b" };
  pruneState(s, rows);
  assert.deepEqual(s, { expanded: null, selected: "b" });
  const t = { expanded: "a", selected: "gone" };
  pruneState(t, rows);
  assert.deepEqual(t, { expanded: "a", selected: null });
});
