// Pure helpers for the header: the branch filter and Find. Plain ES module (runs in Herdr and Node).

/**
 * The branch filter is a list of full ref names (refs/heads/x, refs/remotes/origin/x), or null
 * for Show All. An empty list is never kept: it means Show All.
 * @typedef {string[]|null} BranchFilter
 */

/** @param {string[]} list @returns {BranchFilter} */
const norm = (list) => (list.length ? list : null);

/**
 * Check or uncheck one branch in the filter.
 * @param {BranchFilter} filter
 * @param {string} name full ref name
 * @returns {BranchFilter}
 */
export function toggleBranch(filter, name) {
  const cur = filter ?? [];
  return norm(cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]);
}

/**
 * Remove a branch, given by full ref name or short name ("topic", "origin/topic").
 * @param {BranchFilter} filter
 * @param {string} name
 * @returns {BranchFilter}
 */
export function removeBranch(filter, name) {
  if (!filter) return null;
  return norm(filter.filter((n) => n !== name && shortRef(n) !== name));
}

/**
 * Keep only refs that still exist and, when remote branches are hidden, only local ones.
 * @param {BranchFilter} filter
 * @param {{name:string, kind:string}[]} refs
 * @param {boolean} remotes
 * @returns {BranchFilter}
 */
export function pruneFilter(filter, refs, remotes) {
  if (!filter) return null;
  const ok = new Set(refs.filter((r) => r.kind === "head" || (remotes && r.kind === "remote")).map((r) => r.name));
  const kept = filter.filter((n) => ok.has(n));
  return kept.length === filter.length ? filter : norm(kept);
}

/** "refs/heads/x" → "x", "refs/remotes/origin/x" → "origin/x". */
export function shortRef(name) {
  return name.replace(/^refs\/(heads|remotes|tags)\//, "");
}

/**
 * The dropdown's entries: local branches, then (when shown) remote ones, each with its check.
 * @param {{name:string, short:string, kind:string}[]} refs
 * @param {BranchFilter} filter
 * @param {boolean} remotes
 * @returns {{name:string, label:string, kind:"head"|"remote", checked:boolean}[]}
 */
export function branchEntries(refs, filter, remotes) {
  const on = new Set(filter ?? []);
  const pick = (kind) => refs.filter((r) => r.kind === kind)
    .map((r) => ({ name: r.name, label: r.short, kind, checked: on.has(r.name) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...pick("head"), ...(remotes ? pick("remote") : [])];
}

/**
 * The dropdown button's text.
 * @param {BranchFilter} filter
 */
export function filterLabel(filter) {
  if (!filter) return "Show All";
  if (filter.length === 1) return shortRef(filter[0]);
  return `${filter.length} branches`;
}

/**
 * Rows matching a Find query, in row order (loaded rows only). Case-insensitive substring of
 * the subject, author or a ref's short name; a hash matches by prefix.
 * @param {{hash:string, kind:string, commit?:any, stash?:any}[]} rows
 * @param {Map<string, {label:string}[]>} chips ref chips by commit hash
 * @param {string} query
 * @returns {string[]} matching row hashes
 */
export function findMatches(rows, chips, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [];
  const has = (s) => typeof s === "string" && s.toLowerCase().includes(q);
  const out = [];
  for (const r of rows) {
    let hit = false;
    if (r.kind === "commit") {
      const c = r.commit;
      hit = has(c.subject) || has(c.author) || c.hash.startsWith(q) || (chips.get(c.hash) ?? []).some((x) => has(x.label));
    } else if (r.kind === "stash") {
      hit = has(r.stash.subject) || has(r.stash.selector) || r.hash.startsWith(q);
    }
    if (hit) out.push(r.hash);
  }
  return out;
}

/**
 * The next current match after `delta` steps (wraps around). With no current match (or one no
 * longer matching), the first step lands on the first match (or the last, going back).
 * @param {string[]} matches
 * @param {string|null} current
 * @param {1|-1} delta
 * @returns {string|null}
 */
export function stepMatch(matches, current, delta) {
  if (!matches.length) return null;
  const i = current ? matches.indexOf(current) : -1;
  if (i < 0) return delta > 0 ? matches[0] : matches[matches.length - 1];
  return matches[(i + delta + matches.length) % matches.length];
}

/** "n/m" for the Find box: n is 0 when nothing is current. */
export function matchCount(matches, current) {
  return `${current ? matches.indexOf(current) + 1 : 0}/${matches.length}`;
}
