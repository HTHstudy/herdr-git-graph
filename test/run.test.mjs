import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, git, ISOLATED_ENV } from "./helpers.mjs";
import { busyLabel, busyValue, BUSY_STALE, stepTimeout, envArgv, errorTail, hasConflicts, outcome, actionLabel } from "../mods/git-graph/lib/run.js";
import { planFor } from "../mods/git-graph/lib/actions.js";
import { statusArgs } from "../mods/git-graph/lib/git.js";
import { parseStatus } from "../mods/git-graph/lib/parse.js";

test("busyLabel: fresh value gives its label; empty, malformed and stale give null", () => {
  const now = 1_000_000_000;
  assert.equal(busyLabel(busyValue("Fetch", now - 5000), now), "Fetch");
  assert.equal(busyLabel(busyValue("Fetch", now - BUSY_STALE), now), "Fetch");
  assert.equal(busyLabel(busyValue("Fetch", now - BUSY_STALE - 1), now), null);
  assert.equal(busyLabel(null, now), null);
  assert.equal(busyLabel(undefined, now), null);
  assert.equal(busyLabel("Fetch", now), null, "the old string shape has no age: treated as left over");
  assert.equal(busyLabel({ label: "Fetch" }, now), null);
  assert.equal(busyLabel({ since: now }, now), null);
  assert.equal(busyLabel(busyValue("X", now + BUSY_STALE + 1), now), null, "a clock far ahead is not trusted either");
});

test("stepTimeout: network steps 120 s, others 30 s", () => {
  assert.equal(stepTimeout(["fetch", "--all"]), 120000);
  assert.equal(stepTimeout(["push", "origin", "--delete", "x"]), 120000);
  assert.equal(stepTimeout(["pull", "origin", "x"]), 120000);
  assert.equal(stepTimeout(["reset", "--hard", "abc"]), 30000);
  assert.equal(stepTimeout(["cherry-pick", "abc"]), 30000);
});

test("envArgv: no prompt, no editor, no merge editor", () => {
  assert.deepEqual(envArgv(["merge", "x"]), ["GIT_TERMINAL_PROMPT=0", "GIT_EDITOR=true", "GIT_MERGE_AUTOEDIT=no", "git", "merge", "x"]);
});

test("errorTail: last 400 chars of stderr, else stdout, else the exit code", () => {
  const long = "x".repeat(500) + "END";
  assert.equal(errorTail({ code: 1, stderr: long }).length, 400);
  assert.ok(errorTail({ code: 1, stderr: long }).endsWith("END"));
  assert.equal(errorTail({ code: 1, stderr: "", stdout: " out \n" }), "out");
  assert.equal(errorTail({ code: 128, stderr: "", stdout: "" }), "git exited 128");
});

test("hasConflicts / outcome", () => {
  assert.equal(hasConflicts([{ conflict: false }, { conflict: true }]), true);
  assert.equal(hasConflicts([]), false);
  assert.deepEqual(outcome("Reset", { failed: null, conflicts: false }), []);
  assert.deepEqual(outcome("Reset", { failed: { code: 1, stderr: "fatal: nope" }, conflicts: false }),
    [{ title: "Reset failed", body: "fatal: nope", level: "error" }]);
  assert.deepEqual(outcome("Fetch", { failed: new Error("timed out"), conflicts: false }),
    [{ title: "Fetch failed", body: "timed out", level: "error" }]);
  assert.deepEqual(outcome("Cherry Pick", { failed: { code: 1, stderr: "error: could not apply" }, conflicts: true }),
    [{ title: "Conflicts", body: "Resolve in nvim or Changes", level: "warning" }]);
  assert.deepEqual(outcome("Fetch", { failed: null, conflicts: true }), [], "a conflict already there is not this action's news");
});

test("actionLabel drops the trailing ellipsis", () => {
  assert.equal(actionLabel("Cherry Pick…"), "Cherry Pick");
  assert.equal(actionLabel("Checkout Branch"), "Checkout Branch");
});

test("a cherry-pick conflict through envArgv: non-zero exit, no hang, conflict seen in status", async () => {
  const d = await fixture();
  git(d, "stash", "push", "-u", "-q");
  writeFileSync(join(d, "x.txt"), "other\n");
  git(d, "add", "x.txt");
  git(d, "-c", "user.name=T", "-c", "user.email=t@e", "commit", "-q", "-m", "x on main");
  const f1 = git(d, "rev-parse", "feature/x~1");
  const plan = planFor("cherryPick", { kind: "commit", hash: f1, parents: [git(d, "rev-parse", f1 + "^")], subject: "feat x 1" }, {}, { head: "main", remotes: ["origin"], filtered: [] });
  const env = { ...process.env, ...ISOLATED_ENV, GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@e", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@e" };
  const r = spawnSync("env", envArgv(plan.steps[0]), { cwd: d, env, encoding: "utf8", timeout: 30000 });
  assert.notEqual(r.status, 0);
  const st = spawnSync("git", statusArgs(), { cwd: d, env, encoding: "utf8" });
  const conflicts = hasConflicts(parseStatus(st.stdout));
  assert.equal(conflicts, true);
  assert.deepEqual(outcome("Cherry Pick", { failed: { code: r.status, stderr: r.stderr }, conflicts }).map((n) => n.title), ["Conflicts"]);
});
