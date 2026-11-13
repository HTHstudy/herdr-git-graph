// Argv builders for read-only git loads. Plain ES module (runs in Herdr and Node).

/** Prefix for every git read. */
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

/**
 * `branches`: full ref names (refs/heads/x, refs/remotes/origin/x) to list exactly, or null for
 * every branch, tag, HEAD and (with `remotes`) remote branch. Missing refs are skipped
 * (--ignore-missing) and "--" ends the revisions, so a branch named like a file is not a path.
 * @param {{branches: string[]|null, remotes: boolean, count: number}} o
 * @returns {string[]}
 */
export function logArgs({ branches, remotes, count }) {
  return [
    ...READ,
    "log",
    "--date-order",
    "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1e",
    "-n",
    String(count),
    ...(branches?.length ? ["--ignore-missing", ...branches] : ["--branches", "--tags", ...(remotes ? ["--remotes"] : []), "HEAD"]),
    "--",
  ];
}

// for-each-ref takes %xx hex escapes (%1f), not git-log's %x1f.
/** @returns {string[]} */
export function refsArgs() {
  return [
    ...READ,
    "for-each-ref",
    "--format=%(objectname)%1f%(*objectname)%1f%(refname)%1f%(HEAD)%1f%(upstream:short)%1e",
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ];
}

/** @returns {string[]} */
export function stashArgs() {
  return [...READ, "stash", "list", "--format=%H%x1f%P%x1f%gd%x1f%at%x1f%s%x1e"];
}

/** @returns {string[]} */
export function statusArgs() {
  return [...READ, "status", "--porcelain=v1", "-z", "--untracked-files=all"];
}

/**
 * @param {string} hash
 * @param {string|null} parent
 * @returns {string[]}
 */
export function commitFilesArgs(hash, parent) {
  if (parent === null) return [...READ, "diff-tree", "--root", "--numstat", "-z", "-M", "-r", hash];
  return [...READ, "diff", "--numstat", "-z", "-M", parent, hash];
}

/**
 * @param {string} hash
 * @returns {string[]}
 */
export function commitInfoArgs(hash) {
  return [
    ...READ,
    "show",
    "-s",
    "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B",
    hash,
  ];
}

/**
 * Change kinds (A/M/D/R…) of a commit's files, against `parent` (null → root commit).
 * @param {string} hash
 * @param {string|null} parent
 * @returns {string[]}
 */
export function commitStatusArgs(hash, parent) {
  if (parent === null) return [...READ, "diff-tree", "--root", "--name-status", "-z", "-M", "-r", hash];
  return [...READ, "diff", "--name-status", "-z", "-M", parent, hash];
}
