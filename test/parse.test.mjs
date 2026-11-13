import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, git } from "./helpers.mjs";
import {
  logArgs, refsArgs, stashArgs, statusArgs, commitFilesArgs, commitInfoArgs, READ,
} from "../mods/git-graph/lib/git.js";
import {
  parseLog, parseRefs, parseStashes, parseStatus, parseNumstat, parseCommitInfo,
} from "../mods/git-graph/lib/parse.js";

const byMsg = (dir, msg) => git(dir, "log", "--all", "--format=%H", `--grep=^${msg}$`, "-n1");

test("argv builders start with READ", () => {
  for (const a of [logArgs({ branches: null, remotes: true, count: 1 }), refsArgs(), stashArgs(), statusArgs(),
    commitFilesArgs("h", "p"), commitFilesArgs("h", null), commitInfoArgs("h")]) {
    assert.deepEqual(a.slice(0, 3), READ);
  }
  assert.deepEqual(commitFilesArgs("h", null).slice(3), ["diff-tree", "--root", "--numstat", "-z", "-M", "-r", "h"]);
  assert.deepEqual(commitFilesArgs("h", "p").slice(3), ["diff", "--numstat", "-z", "-M", "p", "h"]);
});

test("parseLog", async () => {
  const d = await fixture();
  const log = parseLog(git(d, ...logArgs({ branches: null, remotes: true, count: 300 })));
  assert.equal(log[0].subject, "rename");
  assert.equal(log.find((c) => c.subject === "Merge feature/x").parents.length, 2);
  assert.ok(log.some((c) => c.subject === "remote only"));
  assert.equal(typeof log[0].date, "number");
  assert.equal(parseLog(git(d, ...logArgs({ branches: null, remotes: true, count: 2 }))).length, 2);
  assert.deepEqual(parseLog(""), []);
});

test("parseLog empty repo", () => {
  const d = mkdtempSync(join(tmpdir(), "gg-empty-"));
  git(d, "init", "-q");
  assert.throws(() => git(d, ...logArgs({ branches: null, remotes: false, count: 5 })));
  assert.deepEqual(parseLog(""), []);
});

test("parseRefs", async () => {
  const d = await fixture();
  const refs = parseRefs(git(d, ...refsArgs()));
  assert.ok(refs.some((r) => r.kind === "head" && r.short === "main" && r.current));
  assert.ok(refs.some((r) => r.kind === "head" && r.short === "feature/x" && !r.current));
  assert.ok(refs.some((r) => r.kind === "remote" && r.short === "origin/remote-only"));
  const v11 = refs.find((r) => r.short === "v1.1");
  assert.equal(v11.annotated, true);
  assert.equal(v11.hash, byMsg(d, "Merge feature/x"));
  assert.equal(refs.find((r) => r.short === "v1.0").annotated, false);
  assert.ok(!refs.some((r) => r.short === "origin/HEAD" || r.name.endsWith("/HEAD")));
});

test("parseStashes", async () => {
  const d = await fixture();
  const s = parseStashes(git(d, ...stashArgs()));
  assert.equal(s.length, 1);
  assert.equal(s[0].selector, "stash@{0}");
  assert.ok(s[0].subject.includes("wip stash"));
  assert.equal(s[0].base, git(d, "rev-parse", "HEAD"));
});

test("parseStatus", async () => {
  const d = await fixture();
  const st = parseStatus(git(d, ...statusArgs()));
  assert.equal(st.find((e) => e.path === "README").unstaged, "M");
  assert.equal(st.find((e) => e.path === "staged.txt").staged, "A");
  assert.equal(st.find((e) => e.path === "untracked.txt").untracked, true);
});

test("parseStatus renames and conflicts", () => {
  const st = parseStatus("R  new name\0old name\0UU c.txt\0 M m.txt");
  assert.deepEqual(st[0], { path: "new name", from: "old name", staged: "R", unstaged: null, untracked: false, conflict: false });
  assert.equal(st[1].conflict, true);
  assert.equal(st[2].path, "m.txt");
});

test("parseNumstat", async () => {
  const d = await fixture();
  const c4 = git(d, "rev-parse", "HEAD");
  const ren = parseNumstat(git(d, ...commitFilesArgs(c4, git(d, "rev-parse", "HEAD~1"))));
  assert.equal(ren.length, 1);
  assert.equal(ren[0].path, "dir with space/a renamed.txt");
  assert.equal(ren[0].from, "a.txt");
  const c3 = byMsg(d, "main work");
  const files = parseNumstat(git(d, ...commitFilesArgs(c3, git(d, "rev-parse", c3 + "^"))));
  assert.equal(files.find((f) => f.path === "bin.dat").added, null);
  const root = git(d, "rev-list", "--max-parents=0", "HEAD");
  assert.deepEqual(parseNumstat(git(d, ...commitFilesArgs(root, null))).map((f) => f.path), ["README"]);
});

test("parseCommitInfo", async () => {
  const d = await fixture();
  const h = byMsg(d, "Merge feature/x");
  const info = parseCommitInfo(git(d, ...commitInfoArgs(h)));
  assert.equal(info.hash, h);
  assert.equal(info.parents.length, 2);
  assert.equal(info.subject, "Merge feature/x");
  assert.equal(info.author, "Test");
  assert.equal(info.committerEmail, "t@example.com");
  assert.equal(info.body, "Merge feature/x");
});
