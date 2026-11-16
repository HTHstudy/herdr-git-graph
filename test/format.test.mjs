import { test } from "node:test";
import assert from "node:assert/strict";
import { graphWidth, visibleColumns, relativeDate, refChips, laneX, chipWidth, chipAt, chipPartAt, chipParts, partWidth, chipText, textColumns, pointerScale, CHIP_GAP, CHIP_COLS, CURRENT_MARK } from "../mods/git-graph/lib/format.js";

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
  assert.deepEqual(m.get("y"), [{ label: "HEAD", kind: "head", bold: true, ref: null, current: false, detached: true }]);
  assert.equal(m.get("x")[0].bold, false);
});

test("chipWidth: monospace columns × 6.6 + padding + border, exact", () => {
  assert.equal(chipWidth("main"), Math.ceil(10 + 4 * 6.6) + 2); // 39
  assert.equal(chipWidth("main", true), chipWidth("main"), "bold keeps the advance");
  const narrow = "feat/copy-and-diff-tab"; // 22 columns: shown whole
  assert.equal(chipText(narrow), narrow);
  assert.equal(chipWidth(narrow), Math.ceil(10 + 22 * 6.6) + 2);
  assert.ok(chipWidth(narrow) < 12 + Math.ceil(22 * 6.4) + 12, "no wider than the old estimate plus slack");
});

test("chipText cuts long names to CHIP_COLS columns with …", () => {
  const long = "feature/a-really-long-branch-name-here";
  const cut = chipText(long);
  assert.equal(textColumns(cut), CHIP_COLS);
  assert.ok(cut.endsWith("…") && long.startsWith(cut.slice(0, -1)));
  assert.equal(chipWidth(long), chipWidth(cut));
});

test("CJK counts two columns", () => {
  assert.equal(textColumns("기능"), 4);
  assert.equal(textColumns("a日b"), 4);
  assert.ok(chipWidth("기능") > chipWidth("ab"));
  const cut = chipText("가".repeat(20));
  assert.ok(textColumns(cut) <= CHIP_COLS && cut.endsWith("…"));
});

test("chipAt agrees with chipWidth", () => {
  const chips = [{ label: "main", bold: true }, { label: "origin/feat/copy-and-diff-tab" }, { label: "v1" }];
  const start = 40, w0 = chipWidth("main"), w1 = chipWidth(chips[1].label);
  assert.equal(chipAt(chips, start - 1, start), null);
  assert.equal(chipAt(chips, start, start), chips[0]);
  assert.equal(chipAt(chips, start + w0 - 0.5, start), chips[0]);
  assert.equal(chipAt(chips, start + w0 + 1, start), null, "in the gap");
  assert.equal(chipAt(chips, start + w0 + CHIP_GAP, start), chips[1]);
  assert.equal(chipAt(chips, start + w0 + CHIP_GAP + w1 + CHIP_GAP, start), chips[2]);
});

test("pointerScale: item height over layout height, else zoom, else 1", () => {
  assert.equal(pointerScale({ x: 0, y: 0, width: 300, height: 28.6 }, 26, 1.1), 28.6 / 26);
  assert.equal(pointerScale({ size: { height: 52 } }, 26, 1), 2);
  assert.equal(pointerScale(undefined, 26, 1.1), 1.1);
  assert.equal(pointerScale({ height: 0 }, 26, 1.25), 1.25);
  assert.equal(pointerScale({ height: 9999 }, 26, undefined), 1, "implausible height ignored");
  assert.equal(pointerScale(null, 26, "x"), 1);
});

test("current branch: ✓ mark first, one column, width exact; it leads the row's chips", () => {
  const refs = [
    { hash: "a", kind: "tag", short: "v1", current: false },
    { hash: "a", kind: "head", short: "topic", current: false },
    { hash: "a", kind: "head", short: "main", current: true },
  ];
  const [cur, other] = refChips(refs, "main", "a").get("a");
  assert.equal(cur.label, "main");
  assert.ok(cur.current && !other.current);
  assert.equal(textColumns(CURRENT_MARK), 2);
  assert.equal(chipParts(cur)[0].text, "✓ main");
  assert.equal(chipWidth(cur), Math.ceil(10 + 6 * 6.6) + 2);
  assert.equal(chipWidth(other), chipWidth("topic"));
  // Detached: the HEAD chip, not marked current.
  const det = refChips(refs.map((r) => ({ ...r, current: false })), null, "a").get("a")[0];
  assert.ok(det.detached && !det.current);
  assert.equal(chipParts(det)[0].text, "HEAD");
});

test("chipPartAt: one-part chips name their ref", () => {
  const refs = [{ hash: "a", kind: "head", short: "main", current: true }, { hash: "a", kind: "tag", short: "v1", current: false }];
  const chips = refChips(refs, "main", "a").get("a");
  const hit = chipPartAt(chips, 10 + chipWidth(chips[0]) + CHIP_GAP + 1, 10);
  assert.equal(hit.chip, chips[1]);
  assert.equal(hit.part.ref, refs[1]);
  assert.equal(chipPartAt(chips, 11, 10).part.ref, refs[0]);
});
