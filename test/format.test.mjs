import { test } from "node:test";
import assert from "node:assert/strict";
import { graphWidth, visibleColumns, relativeDate, refChips, laneX } from "../mods/git-graph/lib/format.js";

test("graphWidth counts lanes from rows and lines, capped at 12", () => {
  assert.equal(graphWidth([]), 24);
  assert.equal(graphWidth([{ lane: 0, lines: [] }]), 24);
  assert.equal(graphWidth([{ lane: 0, lines: [{ from: 2, to: 0 }] }]), 3 * 14 + 10);
  assert.equal(graphWidth([{ lane: 1, lines: [] }]), 2 * 14 + 10);
  assert.equal(graphWidth([{ lane: 11, lines: [{ from: 11, to: 11 }] }]), 12 * 14 + 10);
});

test("laneX centers lanes inside the cell", () => {
  assert.equal(laneX(0), 12);
  assert.equal(laneX(2), 40);
});

test("visibleColumns thresholds", () => {
  assert.deepEqual(visibleColumns(0), { author: false, date: false, hash: false });
  assert.deepEqual(visibleColumns(419), { author: false, date: false, hash: false });
  assert.deepEqual(visibleColumns(420), { author: true, date: false, hash: false });
  assert.deepEqual(visibleColumns(559), { author: true, date: false, hash: false });
  assert.deepEqual(visibleColumns(560), { author: true, date: true, hash: false });
  assert.deepEqual(visibleColumns(680), { author: true, date: true, hash: true });
  assert.deepEqual(visibleColumns(undefined), { author: false, date: false, hash: false });
});

test("relativeDate", () => {
  const now = 1_000_000_000;
  assert.equal(relativeDate(now - 5, now), "just now");
  assert.equal(relativeDate(now + 50, now), "just now");
  assert.equal(relativeDate(now - 120, now), "2m ago");
  assert.equal(relativeDate(now - 3 * 3600, now), "3h ago");
  assert.equal(relativeDate(now - 2 * 86400, now), "2d ago");
  assert.equal(relativeDate(now - 14 * 86400, now), "2w ago");
  assert.equal(relativeDate(now - 90 * 86400, now), "3mo ago");
  assert.equal(relativeDate(now - 800 * 86400, now), "2y ago");
  assert.equal(relativeDate(NaN, now), "");
  assert.equal(relativeDate(0, now), "");
});

const ref = (hash, kind, short, current = false) => ({ hash, kind, short, current, name: short, annotated: false, upstream: null });

test("refChips groups by hash, current branch first and bold", () => {
  const refs = [ref("b", "tag", "v1.0"), ref("a", "remote", "origin/main"), ref("a", "head", "dev"), ref("a", "head", "main", true), ref("a", "tag", "v2")];
  const m = refChips(refs, "main", "a");
  assert.deepEqual(m.get("a").map((c) => [c.label, c.kind, c.bold]), [
    ["main", "head", true],
    ["dev", "head", false],
    ["origin/main", "remote", false],
    ["v2", "tag", false],
  ]);
  assert.deepEqual(m.get("b").map((c) => c.label), ["v1.0"]);
  assert.equal(m.get("a")[0].ref, refs[3]);
});

test("refChips adds a bold HEAD chip when detached", () => {
  const m = refChips([ref("x", "head", "main")], null, "y");
  assert.deepEqual(m.get("y"), [{ label: "HEAD", kind: "head", bold: true, ref: null }]);
  assert.equal(m.get("x")[0].bold, false);
});
