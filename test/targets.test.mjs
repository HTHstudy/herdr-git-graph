import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, git } from "./helpers.mjs";
import { execFileSync } from "node:child_process";
import {
  rowTarget, refTarget, splitRemote, menuCtx, menuHeight, missingFields, cleanValues, initialValues,
  dialogHeight, tagDetailsArgs, parseTagDetails,
} from "../mods/git-graph/lib/targets.js";
import { menuFor, dialogFor } from "../mods/git-graph/lib/actions.js";
import { chipWidth, chipAt, CHIP_GAP } from "../mods/git-graph/lib/format.js";

const H = "a".repeat(40), P = "b".repeat(40);

test("rowTarget: commit, stash, uncommitted", () => {
  const parents = [P];
  const t = rowTarget({ kind: "commit", hash: H, commit: { hash: H, parents, subject: "s", author: "x" } });
  assert.deepEqual(t, { kind: "commit", hash: H, parents: [P], subject: "s" });
  assert.notEqual(t.parents, parents, "a copy: never tied to live data");
  assert.deepEqual(rowTarget({ kind: "stash", hash: H, stash: { selector: "stash@{0}" } }), { kind: "stash", selector: "stash@{0}", hash: H });
  assert.deepEqual(rowTarget({ kind: "uncommitted", hash: "*" }), { kind: "uncommitted" });
});

test("refTarget: branch, tag, remote (longest known remote wins)", () => {
  assert.deepEqual(refTarget({ kind: "head", short: "topic", current: false, annotated: false, hash: H }, []), { kind: "branch", name: "topic", current: false });
  assert.deepEqual(refTarget({ kind: "head", short: "main", current: true, annotated: false, hash: H }, []), { kind: "branch", name: "main", current: true });
  assert.deepEqual(refTarget({ kind: "tag", short: "v1.1", current: false, annotated: true, hash: H }, []), { kind: "tag", name: "v1.1", annotated: true, hash: H });
  assert.deepEqual(refTarget({ kind: "remote", short: "origin/feature/x", current: false, annotated: false, hash: H }, ["origin"]),
    { kind: "remote", name: "origin/feature/x", remote: "origin", branch: "feature/x" });
  assert.deepEqual(splitRemote("up/stream/main", ["up", "up/stream"]), { remote: "up/stream", branch: "main" });
  assert.deepEqual(splitRemote("gone/main", []), { remote: "gone", branch: "main" });
});

test("menuCtx: short names in `filtered`, so Unselect shows for a filtered branch", () => {
  const ctx = menuCtx({ head: "main", remotes: ["origin"] }, ["refs/heads/topic", "refs/remotes/origin/feature/x"]);
  assert.deepEqual(ctx, { head: "main", remotes: ["origin"], filtered: ["topic", "origin/feature/x"] });
  assert.ok(menuFor({ kind: "branch", name: "topic", current: false }, ctx).some((i) => i.id === "unselect"));
  assert.ok(menuFor({ kind: "remote", name: "origin/feature/x", remote: "origin", branch: "feature/x" }, ctx).some((i) => i.id === "unselect"));
  assert.deepEqual(menuCtx({ head: null, remotes: [] }, null), { head: null, remotes: [], filtered: [] });
});

test("menuHeight: rows 31, separators 9, padding 10", () => {
  assert.equal(menuHeight([{ id: "a" }, "sep", { id: "b" }]), 10 + 31 + 9 + 31);
});

test("dialog form: required text, trimming, initial values, height", () => {
  const ctx = { head: "main", remotes: ["origin"], filtered: [] };
  const commit = { kind: "commit", hash: H, parents: [P], subject: "s" };
  const d = dialogFor("addTag", commit, ctx);
  const v = initialValues(d);
  assert.deepEqual(missingFields("addTag", d, v), ["name"], "the message is optional");
  assert.deepEqual(missingFields("addTag", d, { ...v, name: "  " }), ["name"]);
  assert.deepEqual(missingFields("addTag", d, { ...v, name: "v2" }), []);
  assert.deepEqual(cleanValues(d, { ...v, name: " v2 ", message: " hi \n" }).name, "v2");
  const ar = dialogFor("archive", { kind: "tag", name: "v1.1", annotated: true, hash: H }, ctx);
  assert.deepEqual(missingFields("archive", ar, initialValues(ar)), ["folder"], "file name has a default; folder does not");
  assert.deepEqual(missingFields("reset", dialogFor("reset", commit, ctx), { mode: "hard" }), []);
  assert.ok(dialogHeight(d) > dialogHeight(dialogFor("drop", commit, ctx)));
});

test("chipAt: hit-tests chips laid out at chipWidth, CHIP_GAP apart", () => {
  const a = { label: "main", bold: true }, b = { label: "origin/main" }, c = { label: "v1.1" };
  const chips = [a, b, c], start = 38;
  const wa = chipWidth(a.label, true), wb = chipWidth(b.label);
  assert.equal(chipAt(chips, start - 1, start), null);
  assert.equal(chipAt(chips, start, start), a);
  assert.equal(chipAt(chips, start + wa - 1, start), a);
  assert.equal(chipAt(chips, start + wa + 1, start), null, "the gap");
  assert.equal(chipAt(chips, start + wa + CHIP_GAP, start), b);
  assert.equal(chipAt(chips, start + wa + CHIP_GAP + wb + CHIP_GAP + 2, start), c);
  assert.equal(chipAt(chips, 5000, start), null);
  assert.equal(chipWidth("x".repeat(100)), 160);
});

test("tag details: tagger, date, message of an annotated tag (fixture v1.1)", async () => {
  const d = await fixture();
  const out = execFileSync("git", tagDetailsArgs("v1.1"), { cwd: d, encoding: "utf8" });
  const info = parseTagDetails(out, "v1.1");
  assert.equal(info.tagger, "Test");
  assert.equal(info.email, "t@example.com");
  assert.ok(info.date > 1767225600);
  assert.equal(info.message, "release 1.1");
  assert.equal(info.commit, git(d, "rev-parse", "v1.1^{commit}"));
  assert.equal(parseTagDetails(out, "v1"), null);
});
