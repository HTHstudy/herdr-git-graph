// Pure helpers for the diff pane: target identity and labels, load outcomes, and the rows it draws.
import { parseDiff, sideBySide } from "./diff.js";

/**
 * @typedef {import("./diff.js").DiffTarget} DiffTarget
 * @typedef {import("./diff.js").DLine} DLine
 * @typedef {{key:string, type:"hunk", text:string}
 *   | {key:string, type:"line", line:DLine}
 *   | {key:string, type:"pair", left:DLine|null, right:DLine|null, leftNo:number|null, rightNo:number|null}
 *   | {key:string, type:"notice", text:string}} DiffRow
 */

const FIELDS = ["root", "on", "commit", "parent", "path", "from", "area"];

/** Whether two targets name the same diff (null-safe). */
export function sameTarget(a, b) {
  if (!a || !b) return !a && !b;
  return FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));
}

/** "1a2b3c4" for a commit, "Working tree (staged)" for an uncommitted file. */
export function targetLabel(t) {
  return t.commit ? t.commit.slice(0, 7) : `Working tree (${t.area ?? "unstaged"})`;
}

/** The file's path in the worktree, for "Open in nvim". */
export function absPath(t) {
  return t.root.replace(/\/+$/, "") + "/" + t.path;
}

/** Whether a raw diff deletes the file (so there is no file to open). */
export function deletesFile(text) {
  return /^deleted file mode /m.test(text) || /^\+\+\+ \/dev\/null$/m.test(text);
}

/**
 * What a finished `git diff` means for the pane.
 * Untracked diffs run with --no-index, where exit 1 means "differs" (success).
 * Empty output, or a --no-index file that can't be read, means the file isn't there any more.
 * @returns {{state:"gone"} | {state:"error", error:string} | {state:"ready", diff:ReturnType<typeof parseDiff>, deleted:boolean, raw:string}}
 */
export function diffOutcome(t, r) {
  const okCode = r.code === 0 || (t.area === "untracked" && r.code === 1);
  if (!okCode) {
    const err = (r.stderr || r.stdout || "").trim();
    if (t.area === "untracked" && /could not access|no such file|does not exist/i.test(err)) return { state: "gone" };
    return { state: "error", error: err || `git exited ${r.code}` };
  }
  if (!r.stdout.trim()) return { state: "gone" };
  return { state: "ready", diff: parseDiff(r.stdout), deleted: deletesFile(r.stdout), raw: r.stdout };
}

const TAB = "    ";
const show = (l) => (l ? { ...l, text: l.text.replace(/\t/g, TAB) } : l);

/**
 * The rows the pane's virtual list draws.
 * Binary → one notice; no hunks → one notice; truncated → a trailing notice.
 * @param {{binary:boolean, hunks:import("./diff.js").Hunk[], truncated:boolean}} d
 * @param {"unified"|"split"} mode
 * @param {string|null} from  the rename source, for the no-content note
 * @returns {DiffRow[]}
 */
export function diffRows(d, mode, from = null) {
  if (d.binary) return [{ key: "binary", type: "notice", text: "Binary file · no diff" }];
  if (!d.hunks.length) {
    return [{ key: "empty", type: "notice", text: from ? `Renamed from ${from} · no content changes` : "No content changes" }];
  }
  const rows = [];
  if (mode === "split") {
    let h = -1, n = 0;
    for (const r of sideBySide(d.hunks)) {
      if (r.header !== undefined) { h++; n = 0; rows.push({ key: `h${h}`, type: "hunk", text: r.header }); }
      // A context line is one DLine on both sides: the left gutter shows its old number, the right its new.
      else rows.push({ key: `h${h}.${n++}`, type: "pair", left: show(r.left), right: show(r.right), leftNo: r.left?.old ?? null, rightNo: r.right?.new ?? null });
    }
  } else {
    d.hunks.forEach((hunk, h) => {
      rows.push({ key: `h${h}`, type: "hunk", text: hunk.header });
      hunk.lines.forEach((l, i) => rows.push({ key: `h${h}.${i}`, type: "line", line: show(l) }));
    });
  }
  if (d.truncated) rows.push({ key: "truncated", type: "notice", text: "Diff truncated · too many lines to show" });
  return rows;
}

/** Digits needed for the widest line number in the diff (at least 3). */
export function gutterDigits(d) {
  let max = 0;
  for (const h of d.hunks) for (const l of h.lines) max = Math.max(max, l.old ?? 0, l.new ?? 0);
  return Math.max(3, String(max).length);
}

const isDiffPane = (p, tab) => p.mod === "git-graph" && p.tab === tab;

/** The tab's diff pane: the recorded id while that pane is still a git-graph pane of the tab, else null. */
export function diffPaneOf(list, tab, stored) {
  return stored && list.some((p) => p.pane === stored && isDiffPane(p, tab)) ? stored : null;
}

/** After a split: the git-graph pane of the tab that wasn't there before (null until it shows). */
export function newDiffPane(list, tab, before) {
  const old = new Set(before);
  return list.find((p) => isDiffPane(p, tab) && !old.has(p.pane))?.pane ?? null;
}

/**
 * The tab's diff pane, if it has one: the recorded id while valid; else (stale or missing record)
 * any git-graph pane of the tab other than the focused one (the focused one is the Graph panel
 * when it is itself a pane). Null: split a new one.
 */
export function existingDiffPane(list, tab, stored, focusedPane) {
  return diffPaneOf(list, tab, stored) ?? list.find((p) => isDiffPane(p, tab) && p.pane !== focusedPane)?.pane ?? null;
}

/**
 * Which pane to split the diff pane from: the focused pane when it is a model pane of the tab and
 * not a git-graph one; else the tab's focused pane; else its first non-mod pane; null when none.
 */
export function splitFrom(list, tab, focusedPane) {
  const ok = (p) => p.tab === tab && p.mod !== "git-graph";
  return list.find((p) => p.pane === focusedPane && ok(p))?.pane
    ?? list.find((p) => p.focused && ok(p))?.pane
    ?? list.find((p) => p.tab === tab && !p.mod)?.pane
    ?? null;
}

/** The tab's git-graph panes' ids (taken before a split). */
export function gitGraphPanes(list, tab) {
  return list.filter((p) => isDiffPane(p, tab)).map((p) => p.pane);
}

// ---- tab mode: one diff tab per space ---------------------------------------
// Its pane's props().diff.tab is `space:<spaceId>` (not a tab id), so the target lives at
// `git-graph.diff.space:<spaceId>`; the tab is recorded as `git-graph.diffTab.<spaceId>` = {tab, pane}.

const SPACE = "space:";

/** Where a file click opens its diff: "tab" (default) or "split" (beside the work). */
export function diffWhere(value) {
  return value === "split" ? "split" : "tab";
}

/** The diff key of a space's diff tab. */
export function spaceKey(spaceId) {
  return SPACE + spaceId;
}

/** The space id of a tab-mode key, or null for a split pane's key (a tab id). */
export function keySpace(key) {
  return typeof key === "string" && key.startsWith(SPACE) ? key.slice(SPACE.length) : null;
}

const tabsOf = (spaceList, spaceId) => spaceList.find((s) => s.id === spaceId)?.tabs ?? [];

/** The tab's pane when it is the tab's only pane and a git-graph one, else null. */
function soleGitGraphPane(list, tab) {
  const ps = list.filter((p) => p.tab === tab);
  return ps.length === 1 && ps[0].mod === "git-graph" ? ps[0].pane : null;
}

/**
 * The space's diff tab: the record while its tab is still in the space and its pane still a
 * git-graph pane of that tab (a shell split in beside it is fine); else, when the space has
 * exactly one tab whose only pane is a git-graph pane other than `exclude` (the focused pane,
 * which may be the Graph itself), that one (after a restart ids can change). Null: open one.
 * @returns {{tab: string, pane: string}|null}
 */
export function findDiffTab(spaceList, list, spaceId, stored, exclude = null) {
  const tabs = tabsOf(spaceList, spaceId);
  if (stored?.tab && stored?.pane && tabs.some((t) => t.id === stored.tab)
    && list.some((p) => p.pane === stored.pane && p.tab === stored.tab && p.mod === "git-graph")) {
    return { tab: stored.tab, pane: stored.pane };
  }
  const found = [];
  for (const t of tabs) {
    const pane = soleGitGraphPane(list, t.id);
    if (pane && pane !== exclude) found.push({ tab: t.id, pane });
  }
  return found.length === 1 ? found[0] : null;
}

/** After tab.new: the space's tab that wasn't there before, once its only pane (git-graph) shows. */
export function newDiffTab(spaceList, list, spaceId, beforeTabs) {
  const old = new Set(beforeTabs);
  for (const t of tabsOf(spaceList, spaceId)) {
    if (old.has(t.id)) continue;
    const pane = soleGitGraphPane(list, t.id);
    if (pane) return { tab: t.id, pane };
  }
  return null;
}

/** The space's tab ids (taken before tab.new). */
export function spaceTabs(spaceList, spaceId) {
  return tabsOf(spaceList, spaceId).map((t) => t.id);
}

/** Same {tab, pane} record (null-safe). */
export function sameDiffTab(a, b) {
  return (a?.tab ?? null) === (b?.tab ?? null) && (a?.pane ?? null) === (b?.pane ?? null);
}
