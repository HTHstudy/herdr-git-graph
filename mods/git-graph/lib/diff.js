import { READ } from "./git.js";

export const MAX_DIFF_LINES = 20000;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * @typedef {{root:string,on:string|null,commit:string|null,parent:string|null,path:string,from:string|null,area:"staged"|"unstaged"|"untracked"|null}} DiffTarget
 * @typedef {{kind:" "|"+"|"-",old:number|null,new:number|null,text:string}} DLine
 * @typedef {{header:string,lines:DLine[]}} Hunk
 */

/** git argv for a diff target. Untracked (--no-index) exits 1 on success. */
export function diffArgs(t) {
  if (t.commit) {
    return [...READ, "diff", "--no-color", "-M", t.parent ?? EMPTY_TREE, t.commit, "--", ...(t.from ? [t.from] : []), t.path];
  }
  if (t.area === "staged") return [...READ, "diff", "--no-color", "--cached", "-M", "--", t.path];
  if (t.area === "untracked") return [...READ, "diff", "--no-color", "--no-index", "--", "/dev/null", t.path];
  return [...READ, "diff", "--no-color", "--", t.path];
}

/** @returns {{binary:boolean,hunks:Hunk[],truncated:boolean}} */
export function parseDiff(text) {
  const hunks = [];
  let binary = false;
  let truncated = false;
  let cur = null;
  let o = 0;
  let n = 0;
  let count = 0;
  for (const line of text.split("\n")) {
    if (truncated) break;
    if (line.startsWith("diff --git")) { cur = null; continue; }
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (m) {
      cur = { header: line, lines: [] };
      hunks.push(cur);
      o = Number(m[1]);
      n = Number(m[2]);
      continue;
    }
    if (!cur) {
      if (/^Binary files .* differ$/.test(line) || line === "GIT binary patch") binary = true;
      continue;
    }
    const c = line[0];
    if (c !== " " && c !== "+" && c !== "-") continue; // "\ No newline", blank trailer, next "diff --git"
    if (count >= MAX_DIFF_LINES) { truncated = true; break; }
    count++;
    const t = line.slice(1);
    if (c === " ") cur.lines.push({ kind: " ", old: o++, new: n++, text: t });
    else if (c === "-") cur.lines.push({ kind: "-", old: o++, new: null, text: t });
    else cur.lines.push({ kind: "+", old: null, new: n++, text: t });
  }
  return { binary, hunks, truncated };
}

/**
 * Side-by-side rows. Each hunk emits one `{left:null,right:null,header}` row
 * first (so the UI can draw the hunk boundary), then paired rows: a run of `-`
 * pairs with the immediately following run of `+`; leftovers pair with null;
 * context lines appear on both sides.
 * @returns {{left:DLine|null,right:DLine|null,header?:string}[]}
 */
export function sideBySide(hunks) {
  const rows = [];
  for (const h of hunks) {
    rows.push({ left: null, right: null, header: h.header });
    const ls = h.lines;
    for (let i = 0; i < ls.length; ) {
      if (ls[i].kind === " ") { rows.push({ left: ls[i], right: ls[i] }); i++; continue; }
      const dels = [];
      const adds = [];
      while (i < ls.length && ls[i].kind === "-") dels.push(ls[i++]);
      while (i < ls.length && ls[i].kind === "+") adds.push(ls[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    }
  }
  return rows;
}
