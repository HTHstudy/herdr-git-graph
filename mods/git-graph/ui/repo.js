// Where the graph looks, git exec wrappers, and the repository loader (impure: uses herdr).
import { spaces, panes, focused, exec } from "herdr";
import { READ, logArgs, refsArgs, stashArgs, statusArgs } from "../lib/git.js";
import { parseLog, parseRefs, parseStashes, parseStatus } from "../lib/parse.js";
import { layoutGraph } from "../lib/lanes.js";

const TIMEOUT = 30000;

/** The focused folder and machine: the same rule as the shipped `changes` mod. */
export function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const cwd = pane?.cwd || f?.cwd || space?.folder;
  return { cwd, on, key: JSON.stringify({ cwd, on }) };
}

/** @returns {Promise<import("herdr").ExecResult>} */
export function git(root, on, args, opts) {
  return exec("git", args, { cwd: root, on, timeout: opts?.timeout ?? TIMEOUT });
}

const ok = (r, what) => {
  if (r.code !== 0) throw new Error(`git ${what}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
};

/**
 * @param {string} cwd
 * @param {string|null} on
 * @param {{branches: string[]|null, remotes: boolean, count: number}} opts
 */
export async function loadRepo(cwd, on, { branches, remotes, count }) {
  const top = await git(cwd, on, [...READ, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { notRepo: true };
  const root = top.stdout.trim();
  const run = (args) => git(root, on, args);
  const [abbrev, full] = await Promise.all([
    run([...READ, "rev-parse", "--abbrev-ref", "HEAD"]),
    run([...READ, "rev-parse", "--verify", "-q", "HEAD"]),
  ]);
  if (full.code !== 0) return { empty: true, root };
  const headHash = full.stdout.trim();
  const branch = abbrev.code === 0 ? abbrev.stdout.trim() : "HEAD";
  const head = branch === "HEAD" ? null : branch;
  const [log, refs, stash, status, remote] = await Promise.all([
    run(logArgs({ branches, remotes, count })),
    run(refsArgs()),
    run(stashArgs()),
    run(statusArgs()),
    run([...READ, "remote"]),
  ]);
  const commits = parseLog(ok(log, "log"));
  const stashes = stash.code === 0 ? parseStashes(stash.stdout) : [];
  const entries = parseStatus(ok(status, "status"));
  return {
    root,
    head,
    headHash,
    commits,
    refs: parseRefs(ok(refs, "for-each-ref")),
    stashes,
    status: entries,
    remotes: remote.code === 0 ? remote.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : [],
    rows: layoutGraph(commits, stashes, headHash, entries.length > 0),
    more: commits.length === count,
  };
}
