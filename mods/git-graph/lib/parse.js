// Parsers for the git outputs produced by the argv in git.js. Plain ES module.

/**
 * @typedef {{hash: string, parents: string[], author: string, email: string, date: number, subject: string}} Commit
 * @typedef {{hash: string, name: string, kind: "head"|"remote"|"tag", short: string, current: boolean, annotated: boolean, upstream: string|null}} Ref
 * @typedef {{hash: string, base: string, selector: string, date: number, subject: string}} Stash
 * @typedef {{path: string, from: string|null, staged: string|null, unstaged: string|null, untracked: boolean, conflict: boolean}} StatusEntry
 * @typedef {{path: string, from: string|null, added: number|null, deleted: number|null}} FileChange
 * @typedef {Commit & {committer: string, committerEmail: string, committerDate: number, body: string}} CommitInfo
 */

/** Split on the record separator, dropping blank records (tolerates missing trailing separator). */
function records(stdout) {
  return String(stdout ?? "")
    .split("\x1e")
    .map((r) => r.replace(/^\n+/, ""))
    .filter((r) => r.trim() !== "");
}

const splitParents = (p) => (p ? p.split(" ").filter(Boolean) : []);

/** @returns {Commit[]} */
export function parseLog(stdout) {
  return records(stdout).map((r) => {
    const [hash, parents, author, email, at, ...rest] = r.split("\x1f");
    return { hash, parents: splitParents(parents), author, email, date: Number(at), subject: rest.join("\x1f") };
  });
}

/** @returns {Ref[]} */
export function parseRefs(stdout) {
  const out = [];
  for (const r of records(stdout)) {
    const [obj, peeled, name, head, upstream] = r.split("\x1f");
    let kind, prefix;
    if (name.startsWith("refs/heads/")) [kind, prefix] = ["head", "refs/heads/"];
    else if (name.startsWith("refs/remotes/")) [kind, prefix] = ["remote", "refs/remotes/"];
    else if (name.startsWith("refs/tags/")) [kind, prefix] = ["tag", "refs/tags/"];
    else continue;
    const short = name.slice(prefix.length);
    if (kind === "remote" && (short === "HEAD" || short.endsWith("/HEAD"))) continue;
    out.push({
      hash: kind === "tag" && peeled ? peeled : obj,
      name,
      kind,
      short,
      current: kind === "head" && head === "*",
      annotated: kind === "tag" && Boolean(peeled),
      upstream: upstream ? upstream : null,
    });
  }
  return out;
}

/** @returns {Stash[]} */
export function parseStashes(stdout) {
  return records(stdout).map((r) => {
    const [hash, parents, selector, at, ...rest] = r.split("\x1f");
    return {
      hash,
      base: splitParents(parents)[0] ?? "",
      selector,
      date: Number(at),
      subject: rest.join("\x1f"),
    };
  });
}

const CONFLICTS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** @returns {StatusEntry[]} */
export function parseStatus(stdout) {
  const toks = String(stdout ?? "").split("\0");
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.length < 4) continue;
    const xy = t.slice(0, 2);
    const path = t.slice(3);
    if (xy === "!!") continue;
    const untracked = xy === "??";
    let from = null;
    if (!untracked && (xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C")) {
      from = toks[++i] ?? null;
    }
    out.push({
      path,
      from,
      staged: untracked || xy[0] === " " ? null : xy[0],
      unstaged: untracked || xy[1] === " " ? null : xy[1],
      untracked,
      conflict: CONFLICTS.has(xy),
    });
  }
  return out;
}

/** @returns {FileChange[]} */
export function parseNumstat(stdout) {
  const toks = String(stdout ?? "").split("\0");
  const out = [];
  const num = (s) => (s === "-" ? null : Number(s));
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.includes("\t")) continue; // blanks and diff-tree's leading commit id
    const [a, d, ...p] = t.split("\t");
    const path = p.join("\t");
    if (path === "") {
      const from = toks[++i] ?? "";
      const to = toks[++i] ?? "";
      out.push({ path: to, from, added: num(a), deleted: num(d) });
    } else {
      out.push({ path, from: null, added: num(a), deleted: num(d) });
    }
  }
  return out;
}

/** @returns {CommitInfo} */
export function parseCommitInfo(stdout) {
  const parts = String(stdout ?? "").split("\x1f");
  const [hash, parents, author, email, at, committer, committerEmail, ct, ...rest] = parts;
  const body = rest.join("\x1f").replace(/\s+$/, "");
  return {
    hash,
    parents: splitParents(parents),
    author,
    email,
    date: Number(at),
    committer,
    committerEmail,
    committerDate: Number(ct),
    subject: body.split("\n")[0],
    body,
  };
}
