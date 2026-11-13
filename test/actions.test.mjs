import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, git } from "./helpers.mjs";
import { menuFor, dialogFor, planFor } from "../mods/git-graph/lib/actions.js";

const ctx = { head: "main", remotes: ["origin"], filtered: [] };
const H = "a".repeat(40), P1 = "b".repeat(40), P2 = "c".repeat(40);
const commit = { kind: "commit", hash: H, parents: [P1], subject: "subj" };
const mergeC = { ...commit, parents: [P1, P2] };
const rootC = { ...commit, parents: [] };
const branch = { kind: "branch", name: "topic", current: false };
const curBranch = { kind: "branch", name: "main", current: true };
const remote = { kind: "remote", name: "origin/x", remote: "origin", branch: "x" };
const tag = { kind: "tag", name: "v1.1", annotated: true, hash: H };
const stash = { kind: "stash", selector: "stash@{0}", hash: H };
const unc = { kind: "uncommitted" };
const ids = (m) => m.map((i) => (i === "sep" ? "sep" : i.id));

test("menuFor commit", () => {
  assert.deepEqual(ids(menuFor(commit, { ...ctx, dropable: true })), ["addTag", "createBranch", "sep", "checkout", "cherryPick", "revert", "drop", "sep",
    "merge", "rebase", "reset", "sep", "copyHash", "copySubject"]);
  assert.ok(!ids(menuFor(commit, ctx)).includes("drop"), "Drop needs the right-click check (ctx.dropable)");
  assert.ok(!ids(menuFor(commit, { ...ctx, dropable: false })).includes("drop"));
  assert.equal(menuFor(commit, ctx)[0].label, "Add Tag…");
  assert.deepEqual(ids(menuFor(commit, { ...ctx, head: null })), ["addTag", "createBranch", "sep", "checkout", "cherryPick", "revert", "sep", "copyHash", "copySubject"]);
  assert.ok(!ids(menuFor(mergeC, { ...ctx, dropable: true })).includes("drop"));
  assert.ok(!ids(menuFor(rootC, { ...ctx, dropable: true })).includes("drop"));
});

test("menuFor branch / remote / tag / uncommitted / stash", () => {
  assert.deepEqual(ids(menuFor(branch, ctx)), ["checkoutBranch", "renameBranch", "deleteBranch", "mergeBranch", "rebaseOnBranch", "pushBranch", "sep", "archive", "sep", "copyName"]);
  assert.deepEqual(ids(menuFor(branch, { ...ctx, remotes: [], filtered: ["topic"] })), ["checkoutBranch", "renameBranch", "deleteBranch", "mergeBranch", "rebaseOnBranch", "sep", "archive", "unselect", "sep", "copyName"]);
  assert.deepEqual(ids(menuFor(curBranch, ctx)), ["renameBranch", "pushBranch", "sep", "archive", "sep", "copyName"]);
  assert.deepEqual(ids(menuFor(curBranch, { ...ctx, remotes: [], filtered: ["main"] })), ["renameBranch", "sep", "archive", "unselect", "sep", "copyName"]);
  assert.deepEqual(ids(menuFor(remote, ctx)), ["checkoutRemote", "deleteRemote", "fetchIntoLocal", "mergeBranch", "pullBranch", "sep", "archive", "sep", "copyName"]);
  assert.ok(ids(menuFor(remote, { ...ctx, filtered: ["origin/x"] })).includes("unselect"));
  assert.deepEqual(ids(menuFor(tag, ctx)), ["tagDetails", "deleteTag", "pushTag", "sep", "archive", "sep", "copyTagName"]);
  assert.deepEqual(ids(menuFor({ ...tag, annotated: false }, { ...ctx, remotes: [] })), ["deleteTag", "sep", "archive", "sep", "copyTagName"]);
  assert.deepEqual(ids(menuFor(unc, ctx)), ["stashPush", "resetUncommitted", "clean", "sep", "openChanges"]);
  assert.deepEqual(ids(menuFor(stash, ctx)), ["stashApply", "stashBranch", "stashPop", "stashDrop", "sep", "copyStashName", "copyStashHash"]);
  assert.equal(menuFor(unc, ctx)[4].label, "Open Changes panel");
});

test("detached head omits current-branch-dependent branch/remote items", () => {
  const d = { ...ctx, head: null };
  assert.deepEqual(ids(menuFor(branch, d)), ["checkoutBranch", "renameBranch", "deleteBranch", "pushBranch", "sep", "archive", "sep", "copyName"]);
  assert.deepEqual(ids(menuFor(remote, d)), ["checkoutRemote", "deleteRemote", "fetchIntoLocal", "sep", "archive", "sep", "copyName"]);
});

test("addTag without remotes has no push field and no push step", () => {
  const nr = { ...ctx, remotes: [] };
  const keys = dialogFor("addTag", commit, nr).fields.map((f) => f.key);
  assert.ok(!keys.includes("push") && !keys.includes("remote"));
  assert.deepEqual(plan("addTag", commit, { name: "t", annotated: false, push: true }, nr), [["tag", "t", H]]);
});

test("menus never have leading/trailing/double sep", () => {
  const targets = [commit, mergeC, rootC, branch, curBranch, remote, tag, stash, unc];
  for (const t of targets) for (const c of [ctx, { ...ctx, head: null, remotes: [] }]) {
    const m = menuFor(t, c);
    assert.notEqual(m[0], "sep"); assert.notEqual(m.at(-1), "sep");
    m.forEach((x, i) => assert.ok(!(x === "sep" && m[i - 1] === "sep")));
  }
});

test("dialogFor defaults", () => {
  const f = (id, t, k) => dialogFor(id, t, ctx).fields.find((x) => x.key === k);
  const r = f("reset", commit, "mode");
  assert.equal(r.type, "radio"); assert.deepEqual(r.options.map((o) => o.value), ["soft", "mixed", "hard"]); assert.equal(r.value, "mixed");
  assert.equal(f("createBranch", commit, "checkout").value, false);
  assert.deepEqual(["noFF", "squash", "noCommit"].map((k) => f("merge", commit, k).value), [true, false, false]);
  assert.equal(f("cherryPick", commit, "parent"), undefined);
  assert.equal(f("cherryPick", mergeC, "parent").value, 1);
  assert.equal(f("cherryPick", mergeC, "parent").options.length, 2);
  assert.ok(f("revert", mergeC, "parent")); assert.equal(f("revert", commit, "parent"), undefined);
  assert.equal(f("deleteBranch", branch, "force").value, false);
  assert.deepEqual(["remote", "setUpstream", "force"].map((k) => f("pushBranch", branch, k).value), ["origin", true, false]);
  assert.deepEqual(["annotated", "push"].map((k) => f("addTag", commit, k).value), [true, false]);
  assert.equal(f("deleteTag", tag, "remote").value, false);
  assert.equal(f("stashPush", unc, "includeUntracked").value, true);
  assert.equal(f("stashApply", stash, "index").value, false);
  assert.equal(f("clean", unc, "dirs").value, false);
  assert.equal(f("checkoutRemote", { ...remote, name: "origin/feat/y" }, "local").value, "feat/y");
  assert.equal(f("archive", branch, "format").value, "zip");
});

test("null dialogs", () => {
  for (const id of ["checkoutBranch", "copyHash", "copySubject", "copyName", "copyTagName", "copyStashName", "copyStashHash", "unselect", "openChanges", "tagDetails"])
    assert.equal(dialogFor(id, commit, ctx), null, id);
});

test("danger dialogs", () => {
  const cases = { drop: commit, reset: commit, deleteBranch: branch, deleteRemote: remote, deleteTag: tag, resetUncommitted: unc, clean: unc, stashDrop: stash };
  for (const [id, t] of Object.entries(cases)) assert.equal(dialogFor(id, t, ctx).danger, true, id);
  assert.equal(dialogFor("pushBranch", branch, ctx).danger, false);
  assert.equal(dialogFor("fetchIntoLocal", remote, ctx).danger, false);
});

const plan = (id, t, v = {}, c = ctx) => planFor(id, t, v, c).steps;

test("planFor argv", () => {
  assert.deepEqual(plan("addTag", commit, { name: "t", annotated: true, message: "m", push: true, remote: "origin" }),
    [["tag", "-a", "t", "-m", "m", H], ["push", "origin", "refs/tags/t"]]);
  assert.deepEqual(plan("addTag", commit, { name: "t", annotated: false }), [["tag", "t", H]]);
  assert.deepEqual(plan("createBranch", commit, { name: "n", checkout: true }), [["checkout", "-b", "n", H]]);
  assert.deepEqual(plan("createBranch", commit, { name: "n", checkout: false }), [["branch", "n", H]]);
  assert.deepEqual(plan("checkout", commit), [["checkout", H]]);
  assert.deepEqual(plan("cherryPick", commit, { noCommit: false }), [["cherry-pick", H]]);
  assert.deepEqual(plan("cherryPick", mergeC, { parent: 2, noCommit: true }), [["cherry-pick", "-m", "2", "--no-commit", H]]);
  assert.deepEqual(plan("revert", commit), [["revert", "--no-edit", H]]);
  assert.deepEqual(plan("revert", mergeC, { parent: 1 }), [["revert", "--no-edit", "-m", "1", H]]);
  assert.deepEqual(plan("drop", commit), [["rebase", "--onto", `${H}^`, H]]);
  assert.deepEqual(plan("merge", commit, { noFF: true, squash: false, noCommit: true }), [["merge", "--no-ff", "--no-commit", H]]);
  assert.deepEqual(plan("mergeBranch", branch, { squash: true }), [["merge", "--squash", "topic"]]);
  assert.deepEqual(plan("rebase", commit), [["rebase", H]]);
  assert.deepEqual(plan("rebaseOnBranch", branch), [["rebase", "topic"]]);
  for (const m of ["soft", "mixed", "hard"]) assert.deepEqual(plan("reset", commit, { mode: m }), [["reset", `--${m}`, H]]);
  assert.deepEqual(plan("checkoutBranch", branch), [["checkout", "topic"]]);
  assert.deepEqual(plan("renameBranch", branch, { name: "new" }), [["branch", "-m", "topic", "new"]]);
  assert.deepEqual(plan("deleteBranch", branch, { force: false }), [["branch", "-d", "topic"]]);
  assert.deepEqual(plan("deleteBranch", branch, { force: true }), [["branch", "-D", "topic"]]);
  assert.deepEqual(plan("pushBranch", branch, { remote: "origin", setUpstream: true, force: true }), [["push", "--set-upstream", "--force-with-lease", "origin", "topic"]]);
  assert.deepEqual(plan("pushBranch", branch, { remote: "origin" }), [["push", "origin", "topic"]]);
  assert.deepEqual(plan("archive", branch, { format: "tar", name: "a.tar", folder: "/x" }), [["archive", "--format=tar", "-o", "/x/a.tar", "topic"]]);
  assert.deepEqual(plan("archive", branch, { format: "zip", name: "", folder: "/x" }), [["archive", "--format=zip", "-o", "/x/topic.zip", "topic"]]);
  assert.deepEqual(plan("checkoutRemote", remote, { local: "x" }), [["checkout", "-b", "x", "--track", "origin/x"]]);
  assert.deepEqual(plan("deleteRemote", remote), [["push", "origin", "--delete", "x"]]);
  assert.deepEqual(plan("fetchIntoLocal", remote, { local: "l", force: true }), [["fetch", "origin", "+x:l"]]);
  assert.deepEqual(plan("fetchIntoLocal", remote, { local: "l", force: false }), [["fetch", "origin", "x:l"]]);
  assert.deepEqual(plan("pullBranch", remote, { noFF: true, squash: true }), [["pull", "--no-ff", "--squash", "origin", "x"]]);
  assert.deepEqual(plan("deleteTag", tag, { remote: true, remoteName: "origin" }), [["tag", "-d", "v1.1"], ["push", "origin", "--delete", "refs/tags/v1.1"]]);
  assert.deepEqual(plan("deleteTag", tag, { remote: false }), [["tag", "-d", "v1.1"]]);
  assert.deepEqual(plan("pushTag", tag, { remote: "origin" }), [["push", "origin", "refs/tags/v1.1"]]);
  assert.deepEqual(plan("stashPush", unc, { includeUntracked: true, message: "m" }), [["stash", "push", "--include-untracked", "-m", "m"]]);
  assert.deepEqual(plan("stashPush", unc, { includeUntracked: false, message: "" }), [["stash", "push"]]);
  assert.deepEqual(plan("resetUncommitted", unc, { mode: "hard" }), [["reset", "--hard", "HEAD"]]);
  assert.deepEqual(plan("clean", unc, { dirs: true }), [["clean", "-f", "-d"]]);
  assert.deepEqual(plan("clean", unc, { dirs: false }), [["clean", "-f"]]);
  assert.deepEqual(plan("stashApply", stash, { index: true }), [["stash", "apply", "--index", "stash@{0}"]]);
  assert.deepEqual(plan("stashPop", stash, { index: false }), [["stash", "pop", "stash@{0}"]]);
  assert.deepEqual(plan("stashBranch", stash, { name: "sb" }), [["stash", "branch", "sb", "stash@{0}"]]);
  assert.deepEqual(plan("stashDrop", stash), [["stash", "drop", "stash@{0}"]]);
  assert.deepEqual(planFor("copyHash", commit, {}, ctx), { copy: H });
  assert.deepEqual(planFor("copySubject", commit, {}, ctx), { copy: "subj" });
  assert.deepEqual(planFor("copyName", branch, {}, ctx), { copy: "topic" });
  assert.deepEqual(planFor("copyTagName", tag, {}, ctx), { copy: "v1.1" });
  assert.deepEqual(planFor("copyStashName", stash, {}, ctx), { copy: "stash@{0}" });
  assert.deepEqual(planFor("copyStashHash", stash, {}, ctx), { copy: H });
  assert.deepEqual(planFor("unselect", branch, {}, ctx), { ui: "unselect", arg: "topic" });
  assert.deepEqual(planFor("openChanges", unc, {}, ctx), { ui: "openChanges" });
  assert.deepEqual(planFor("tagDetails", tag, {}, ctx), { ui: "tagDetails", arg: "v1.1" });
});

test("unicode branch name and spaced path are single argv elements", () => {
  const b = { kind: "branch", name: "feature/ünï code", current: false };
  assert.deepEqual(plan("checkoutBranch", b), [["checkout", "feature/ünï code"]]);
  assert.deepEqual(plan("archive", b, { format: "zip", name: "my file.zip", folder: "/a b/c" })[0].slice(2, 4), ["-o", "/a b/c/my file.zip"]);
  assert.equal(plan("archive", b, { format: "zip", name: "", folder: "/a b" })[0][3], "/a b/feature-ünï code.zip");
});

// ---- integration -----------------------------------------------------------

const run = (dir, p) => { for (const s of p.steps) git(dir, ...s); };
const rev = (d, r) => git(d, "rev-parse", r);
const subj = (d, r = "HEAD") => git(d, "log", "-1", "--format=%s", r);
const byMsg = (d, m) => git(d, "log", "--all", "--format=%H", `--grep=^${m}$`, "-n1");
async function fx(clean = true) {
  const d = await fixture();
  if (clean) { git(d, "reset", "--hard"); git(d, "clean", "-fd"); }
  const c = { head: git(d, "branch", "--show-current"), remotes: ["origin"], filtered: [] };
  const cm = (m) => { const h = byMsg(d, m); return { kind: "commit", hash: h, parents: git(d, "log", "-1", "--format=%P", h).split(" ").filter(Boolean), subject: m }; };
  return { d, c, cm };
}

test("int: createBranch", async () => {
  const { d, c, cm } = await fx();
  run(d, planFor("createBranch", cm("add a"), { name: "nb", checkout: false }, c));
  assert.match(git(d, "branch", "--list", "nb"), /nb/);
  assert.equal(rev(d, "nb"), cm("add a").hash);
});

test("int: addTag annotated is a tag object", async () => {
  const { d, c, cm } = await fx();
  run(d, planFor("addTag", cm("add a"), { name: "at", annotated: true, message: "msg" }, c));
  assert.equal(git(d, "cat-file", "-t", "at"), "tag");
});

test("int: cherryPick topic 1 onto main", async () => {
  const { d, c, cm } = await fx();
  run(d, planFor("cherryPick", cm("topic 1"), {}, c));
  assert.equal(subj(d), "topic 1");
});

test("int: revert", async () => {
  const { d, c, cm } = await fx();
  run(d, planFor("revert", cm("rename"), {}, c));
  assert.match(subj(d), /^Revert/);
});

test("int: drop c4", async () => {
  const { d, c, cm } = await fx(false);
  git(d, "stash", "-u");
  run(d, planFor("drop", cm("rename"), {}, c));
  assert.ok(!git(d, "log", "--format=%s").split("\n").includes("rename"));
});

test("int: reset hard c3", async () => {
  const { d, c, cm } = await fx();
  const c3 = cm("main work");
  run(d, planFor("reset", c3, { mode: "hard" }, c));
  assert.equal(rev(d, "HEAD"), c3.hash);
});

test("int: checkout, merge, rebase", async () => {
  const { d, c, cm } = await fx();
  run(d, planFor("checkout", cm("add a"), {}, c));
  assert.equal(git(d, "branch", "--show-current"), "");
  git(d, "checkout", "main");
  run(d, planFor("mergeBranch", { kind: "branch", name: "topic", current: false }, { noFF: true }, c));
  assert.match(subj(d), /^Merge branch 'topic'/);
  const e = await fx();
  git(e.d, "checkout", "topic");
  run(e.d, planFor("rebaseOnBranch", { kind: "branch", name: "main", current: false }, {}, { ...e.c, head: "topic" }));
  assert.equal(git(e.d, "merge-base", "topic", "main"), rev(e.d, "main"));
});

test("int: renameBranch, deleteBranch -D", async () => {
  const { d, c } = await fx();
  run(d, planFor("renameBranch", { kind: "branch", name: "topic", current: false }, { name: "topic2" }, c));
  assert.match(git(d, "branch", "--list", "topic2"), /topic2/);
  run(d, planFor("deleteBranch", { kind: "branch", name: "topic2", current: false }, { force: true }, c));
  assert.equal(git(d, "branch", "--list", "topic2"), "");
});

test("int: pushBranch, deleteRemote, fetchIntoLocal, checkoutRemote", async () => {
  const { d, c } = await fx();
  run(d, planFor("pushBranch", { kind: "branch", name: "topic", current: false }, { remote: "origin", setUpstream: true }, c));
  assert.match(git(d, "ls-remote", "origin", "refs/heads/topic"), /refs\/heads\/topic/);
  const ro = { kind: "remote", name: "origin/remote-only", remote: "origin", branch: "remote-only" };
  run(d, planFor("fetchIntoLocal", ro, { local: "ro", force: false }, c));
  assert.match(git(d, "branch", "--list", "ro"), /ro/);
  run(d, planFor("checkoutRemote", ro, { local: "ro2" }, c));
  assert.equal(git(d, "branch", "--show-current"), "ro2");
  git(d, "checkout", "main");
  run(d, planFor("deleteRemote", ro, {}, c));
  assert.equal(git(d, "ls-remote", "origin", "refs/heads/remote-only"), "");
});

test("int: pullBranch", async () => {
  const { d, c } = await fx();
  git(d, "push", "origin", "main:refs/heads/side");
  git(d, "fetch", "origin");
  run(d, planFor("pullBranch", { kind: "remote", name: "origin/side", remote: "origin", branch: "side" }, {}, c));
  assert.equal(rev(d, "HEAD"), rev(d, "origin/side"));
});

test("int: deleteTag v1.0 locally and remotely, pushTag", async () => {
  const { d, c } = await fx();
  const t = { kind: "tag", name: "v1.0", annotated: false, hash: "" };
  assert.match(git(d, "ls-remote", "--tags", "origin"), /v1\.0/);
  run(d, planFor("deleteTag", t, { remote: true, remoteName: "origin" }, c));
  assert.equal(git(d, "tag", "--list", "v1.0"), "");
  assert.doesNotMatch(git(d, "ls-remote", "--tags", "origin"), /v1\.0/);
  git(d, "tag", "nt");
  run(d, planFor("pushTag", { ...t, name: "nt" }, { remote: "origin" }, c));
  assert.match(git(d, "ls-remote", "--tags", "origin"), /refs\/tags\/nt/);
});

test("int: stash push/apply/pop/branch/drop", async () => {
  const { d, c } = await fx(false);
  const n = () => git(d, "stash", "list").split("\n").filter(Boolean).length;
  assert.equal(n(), 1);
  run(d, planFor("stashPush", unc, { includeUntracked: true, message: "m2" }, c));
  assert.equal(n(), 2);
  assert.equal(git(d, "status", "--porcelain"), "");
  const st = (sel) => ({ kind: "stash", selector: sel, hash: "" });
  run(d, planFor("stashApply", st("stash@{0}"), { index: true }, c));
  assert.equal(n(), 2); assert.notEqual(git(d, "status", "--porcelain"), "");
  git(d, "reset", "--hard"); git(d, "clean", "-fd");
  run(d, planFor("stashPop", st("stash@{0}"), {}, c));
  assert.equal(n(), 1);
  git(d, "reset", "--hard"); git(d, "clean", "-fd");
  run(d, planFor("stashBranch", st("stash@{0}"), { name: "from-stash" }, c));
  assert.equal(git(d, "branch", "--show-current"), "from-stash"); assert.equal(n(), 0);
  git(d, "stash", "push", "-u", "-m", "x");
  run(d, planFor("stashDrop", st("stash@{0}"), {}, c));
});

test("int: resetUncommitted hard + clean -d", async () => {
  const { d, c } = await fx(false);
  git(d, "stash", "-u", "-q"); git(d, "stash", "pop", "-q");
  assert.notEqual(git(d, "status", "--porcelain"), "");
  run(d, planFor("resetUncommitted", unc, { mode: "hard" }, c));
  run(d, planFor("clean", unc, { dirs: true }, c));
  assert.equal(git(d, "status", "--porcelain"), "");
});

test("int: archive zip", async () => {
  const { d, c } = await fx();
  const folder = mkdtempSync(join(tmpdir(), "gg arch-"));
  run(d, planFor("archive", { kind: "branch", name: "main", current: true }, { format: "zip", name: "", folder }, c));
  assert.ok(existsSync(join(folder, "main.zip")));
  run(d, planFor("archive", { kind: "tag", name: "v1.1", annotated: true, hash: "" }, { format: "tar", name: "t.tar", folder }, c));
  assert.ok(existsSync(join(folder, "t.tar")));
});

// ---- guards (review fixes 1 and 6) -----------------------------------------

import { spawnSync } from "node:child_process";
import { guardPasses, guardMessage } from "../mods/git-graph/lib/run.js";
import { dropChecks, headGuard } from "../mods/git-graph/lib/actions.js";

/** The first failing guard's message (as runPlan would show it), or null. */
function checkGuards(dir, guards) {
  for (const g of guards ?? []) {
    const r = spawnSync("git", g.argv, { cwd: dir, encoding: "utf8" });
    const res = { code: r.status, stdout: r.stdout };
    if (!guardPasses(g, res)) return guardMessage(g, res);
  }
  return null;
}

test("guards: which plans carry them", () => {
  const head = headGuard("main");
  for (const [id, t] of [["reset", commit], ["merge", commit], ["mergeBranch", branch], ["rebase", commit],
    ["rebaseOnBranch", branch], ["pullBranch", remote], ["drop", commit]]) {
    const g = planFor(id, t, { mode: "hard" }, ctx).guards;
    assert.deepEqual(g.at(-1), head, id);
  }
  assert.deepEqual(planFor("drop", commit, {}, ctx).guards.slice(0, 2), dropChecks(H));
  for (const id of ["cherryPick", "checkout", "deleteBranch", "stashDrop"]) {
    const t = id === "deleteBranch" ? branch : id === "stashDrop" ? stash : commit;
    assert.equal(planFor(id, t, {}, ctx).guards, undefined, id);
  }
  assert.deepEqual(head.argv.slice(-4), ["symbolic-ref", "--short", "-q", "HEAD"]);
});

test("guardPasses / guardMessage", () => {
  assert.equal(guardPasses({ expect: "ok" }, { code: 0, stdout: "" }), true);
  assert.equal(guardPasses({ expect: "ok" }, { code: 1, stdout: "" }), false);
  assert.equal(guardPasses({ expect: "empty" }, { code: 0, stdout: "\n" }), true);
  assert.equal(guardPasses({ expect: "empty" }, { code: 0, stdout: "abc\n" }), false);
  assert.equal(guardPasses({ expect: { equals: "main" } }, { code: 0, stdout: "main\n" }), true);
  assert.equal(guardPasses({ expect: { equals: "main" } }, { code: 0, stdout: "topic\n" }), false);
  assert.equal(guardMessage(headGuard("main"), { stdout: "topic\n" }), "Current branch changed to topic — reopen the menu.");
  assert.equal(guardMessage(headGuard("main"), { stdout: "" }), "Current branch changed to detached HEAD — reopen the menu.");
});

test("int: drop checks — off-branch commit and commit before a merge are refused, main untouched", async () => {
  const { d, c, cm } = await fx();
  const before = rev(d, "main");
  // topic 1 is not on main: the reviewer's repro (main would have been rebuilt on top of it).
  assert.match(checkGuards(d, planFor("drop", cm("topic 1"), {}, c).guards), /not on the current branch/);
  // main work lies before the merge of feature/x: a plain rebase would flatten it.
  assert.match(checkGuards(d, planFor("drop", cm("main work"), {}, c).guards), /merge commit follows/);
  assert.equal(rev(d, "main"), before);
  // the newest commit on main, with nothing merged after it: allowed, and the drop works.
  const p = planFor("drop", cm("rename"), {}, c);
  assert.equal(checkGuards(d, p.guards), null);
  run(d, p);
  assert.ok(!git(d, "log", "--format=%s").split("\n").includes("rename"));
});

test("int: head guard — a branch switch after the dialog opened blocks reset", async () => {
  const { d, c, cm } = await fx();
  const p = planFor("reset", cm("add a"), { mode: "hard" }, c);
  assert.equal(checkGuards(d, p.guards), null);
  git(d, "checkout", "-q", "topic");
  const topicBefore = rev(d, "topic");
  assert.equal(checkGuards(d, p.guards), "Current branch changed to topic — reopen the menu.");
  assert.equal(rev(d, "topic"), topicBefore, "nothing ran");
  git(d, "checkout", "-q", "--detach", "main");
  assert.match(checkGuards(d, p.guards), /detached HEAD/);
});
