import test from "node:test";
import assert from "node:assert/strict";
import { fixture, git } from "./helpers.mjs";

test("fixture repo has expected shape", async () => {
  const dir = await fixture();
  const log = git(dir, "log", "--oneline", "--all");
  for (const s of ["Merge feature/x", "topic 1", "remote only"]) assert.match(log, new RegExp(s));
  assert.match(git(dir, "stash", "list"), /wip stash/);
  const st = git(dir, "status", "--porcelain");
  assert.match(st, / M README/);
  assert.match(st, /A {2}staged\.txt/);
  assert.match(st, /\?\? untracked\.txt/);
});
