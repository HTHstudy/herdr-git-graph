// Pure helpers for the inline details under an expanded row. Plain ES module (runs in Herdr and Node).

/**
 * @typedef {import("./parse.js").FileChange} FileChange
 * @typedef {import("./parse.js").NameStatus} NameStatus
 * @typedef {import("./parse.js").StatusEntry} StatusEntry
 * @typedef {import("./parse.js").CommitInfo} CommitInfo
 * @typedef {import("./diff.js").DiffTarget} DiffTarget
 * @typedef {FileChange & {status: string}} CommitFile
 * @typedef {{path: string, from: string|null, status: string, area: "staged"|"unstaged"|"untracked", conflict: boolean}} UFile
 * @typedef {{state: "loading"} | {state: "error", error: string} | {state: "ready", info: CommitInfo, files: CommitFile[], parent: string|null}} CommitDetail
 * @typedef {{key: string, part: string, size: number, [k: string]: any}} DetailItem
 */

/** Heights of detail items: a clickable line, a line of text, and the closing gap. */
export const LINE = 22;
export const TEXT = 18;
export const PAD = 6;
/** The most body lines shown inline. */
export const MAX_BODY = 200;

/**
 * Numstat counts with their change kind (by path; a numstat rename is "R" when name-status lacks it).
 * @param {FileChange[]} numstat
 * @param {NameStatus[]} names
 * @returns {CommitFile[]}
 */
export function commitFiles(numstat, names) {
  const kind = new Map(names.map((n) => [n.path, n.status]));
  return numstat.map((f) => ({ ...f, status: kind.get(f.path) ?? (f.from ? "R" : "M") }));
}

/** `+n −m`, or `bin` for a binary file. */
export function fileCounts(f) {
  if (f.added === null || f.deleted === null) return "bin";
  return `+${f.added} −${f.deleted}`;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/**
 * `YYYY-MM-DD HH:MM:SS +HHMM` in the given offset (minutes east of UTC; default: this machine's).
 * @param {number} unix seconds
 * @param {number} [offset]
 */
export function absoluteDate(unix, offset) {
  if (!Number.isFinite(unix)) return "";
  const off = offset ?? -new Date(unix * 1000).getTimezoneOffset();
  const d = new Date((unix + off * 60) * 1000);
  const sign = off < 0 ? "-" : "+", a = Math.abs(off);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${sign}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
}

/** Body text as display lines: tabs expanded, trailing blanks dropped, capped at MAX_BODY. */
export function bodyLines(body) {
  const lines = String(body ?? "").replace(/\t/g, "    ").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > MAX_BODY) return [...lines.slice(0, MAX_BODY), "…"];
  return lines;
}

/** Text safe inside HTML: & < > " escaped. */
export function escapeHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Display lines as one HTML fragment for a selectable TextView: each line escaped, its spaces
 * kept (&nbsp;, so indentation survives and nothing wraps at a space), lines joined by <br>,
 * an empty line kept as one &nbsp; so it still takes its height.
 * @param {string[]} lines
 */
export function linesHtml(lines) {
  return `<span>${lines.map((l) => escapeHtml(l).replace(/ /g, "&nbsp;") || "&nbsp;").join("<br>")}</span>`;
}

/**
 * Diff target of one file of a commit or stash (`parent`: first parent / stash base, null for a root commit).
 * @returns {DiffTarget}
 */
export function commitTarget(root, on, commit, parent, file) {
  return { root, on, commit, parent: parent ?? null, path: file.path, from: file.from ?? null, area: null };
}

/**
 * Diff target of one uncommitted file.
 * @param {UFile} f
 * @returns {DiffTarget}
 */
export function uncommittedTarget(root, on, f) {
  return { root, on, commit: null, parent: null, path: f.path, from: f.area === "staged" ? f.from : null, area: f.area };
}

const letter = (c) => (c === "C" ? "A" : c === "T" ? "M" : c);

/**
 * The uncommitted row's two groups. Conflicts and untracked files go under Changes, both marked `U`.
 * @param {StatusEntry[]} entries
 * @returns {{staged: UFile[], changes: UFile[]}}
 */
export function uncommittedGroups(entries) {
  const staged = [], changes = [];
  for (const e of entries) {
    if (e.conflict) { changes.push({ path: e.path, from: null, status: "U", area: "unstaged", conflict: true }); continue; }
    if (e.untracked) { changes.push({ path: e.path, from: null, status: "U", area: "untracked", conflict: false }); continue; }
    if (e.staged) staged.push({ path: e.path, from: e.from, status: letter(e.staged), area: "staged", conflict: false });
    if (e.unstaged) changes.push({ path: e.path, from: null, status: letter(e.unstaged), area: "unstaged", conflict: false });
  }
  return { staged, changes };
}

/**
 * The list items drawn under an expanded row, each with its own key and height.
 * Every independently clickable thing is its own item (one click handler per list).
 * @param {{kind: string, hash: string}} row
 * @param {CommitDetail|null} detail commit/stash detail (ignored for the uncommitted row)
 * @param {StatusEntry[]} status the uncommitted row's entries
 * @returns {DetailItem[]}
 */
export function detailItems(row, detail, status) {
  const k = (part) => `d:${row.hash}:${part}`;
  /** @type {DetailItem[]} */
  const out = [];
  if (row.kind === "uncommitted") {
    const g = uncommittedGroups(status);
    for (const [name, title] of [["staged", "Staged"], ["changes", "Changes"]]) {
      if (!g[name].length) continue;
      out.push({ key: k(name), part: "group", title: `${title} (${g[name].length})`, size: LINE });
      g[name].forEach((file, i) => out.push({ key: k(`${name}:${i}`), part: "ufile", file, size: LINE }));
    }
    if (!out.length) out.push({ key: k("none"), part: "note", text: "No changes", size: LINE });
  } else if (!detail || detail.state === "loading") {
    out.push({ key: k("loading"), part: "note", text: "Loading…", size: LINE });
  } else if (detail.state === "error") {
    out.push({ key: k("error"), part: "note", text: detail.error, error: true, size: LINE });
  } else {
    const { info, files } = detail;
    out.push({ key: k("hash"), part: "hash", hash: info.hash, size: LINE });
    info.parents.forEach((p, i) => out.push({ key: k(`parent:${i}`), part: "parent", hash: p, size: LINE }));
    out.push({ key: k("meta"), part: "meta", info, size: 3 * TEXT + PAD });
    const lines = bodyLines(info.body);
    if (lines.length) out.push({ key: k("body"), part: "body", lines, size: lines.length * TEXT + 2 * PAD });
    out.push({ key: k("files"), part: "group", title: `${files.length} file${files.length === 1 ? "" : "s"} changed`, size: LINE });
    files.forEach((file, i) => out.push({ key: k(`file:${i}`), part: "file", file, size: LINE }));
  }
  out.push({ key: k("end"), part: "end", size: PAD });
  const lanes = throughLanes(row);
  for (const it of out) it.lanes = lanes;
  return out;
}

/**
 * Lanes that continue below a row (its bottom-half lines' end lanes, one per lane),
 * drawn straight down through the detail block under it.
 * @param {{lines?: {to:number, color:number, half:string}[]}} row
 * @returns {{x:number, color:number}[]}
 */
export function throughLanes(row) {
  const seen = new Set(), out = [];
  for (const l of row.lines ?? []) {
    if (l.half !== "bottom" || seen.has(l.to)) continue;
    seen.add(l.to);
    out.push({ x: l.to, color: l.color });
  }
  return out;
}

/**
 * Forget an expanded/selected hash that is no longer among the rows.
 * @param {{expanded: string|null, selected: string|null}} s mutated
 * @param {{hash:string}[]} rows
 */
export function pruneState(s, rows) {
  if (s.expanded === null && s.selected === null) return;
  const have = new Set(rows.map((r) => r.hash));
  if (s.expanded !== null && !have.has(s.expanded)) s.expanded = null;
  if (s.selected !== null && !have.has(s.selected)) s.selected = null;
}
