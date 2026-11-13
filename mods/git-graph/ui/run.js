// runPlan(): runs an action's git steps under the repo's busy lock, toasts failures and
// conflicts, then signals every Graph copy to refresh. Impure (herdr).
//
// It must run in a long-lived copy (the Graph panel): a menu or dialog overlay's tasks are
// cancelled when it closes, which would leave the busy key set. Overlays hand the plan to
// the panel that opened them through `git-graph.request` (see Panel.request).
import { exec, shared, setShared, notify } from "herdr";
import { statusArgs } from "../lib/git.js";
import { parseStatus } from "../lib/parse.js";
import { busyLabel, busyValue, stepTimeout, envArgv, hasConflicts, outcome } from "../lib/run.js";

export const busyKey = (root) => `git-graph.busy.${root}`;

/** The action label running on a repo, or null (a stale value counts as none). */
export const busyOf = (root) => (root ? busyLabel(shared(busyKey(root)), Date.now()) : null);

/**
 * @param {string} root
 * @param {string|null} on
 * @param {string} label e.g. "Cherry Pick"
 * @param {{steps: string[][]}} plan
 * @param {any} [_cx] the caller's task cx (unused: kept for the interface)
 * @returns {Promise<boolean>} true when every step succeeded
 */
export async function runPlan(root, on, label, plan, _cx) {
  const running = busyOf(root);
  if (running) {
    notify({ title: "Git Graph is busy", body: `${running} is still running; ${label} was not started.`, level: "warning" });
    return false;
  }
  const key = busyKey(root);
  setShared(key, busyValue(label, Date.now()));
  let failed = null;
  try {
    for (const step of plan.steps ?? []) {
      try {
        const r = await exec("env", envArgv(step), { cwd: root, on, timeout: stepTimeout(step) });
        if (r.code !== 0) { failed = r; break; }
      } catch (e) {
        failed = e instanceof Error ? e : new Error(String(e));
        break;
      }
    }
    let conflicts = false;
    try {
      const st = await exec("git", statusArgs(), { cwd: root, on, timeout: 30000 });
      conflicts = st.code === 0 && hasConflicts(parseStatus(st.stdout));
    } catch { /* no status: report the step result alone */ }
    for (const n of outcome(label, { failed, conflicts })) notify(n);
  } finally {
    setShared(key, null);
    setShared("git-graph.changed", { root, at: Date.now() });
  }
  return !failed;
}
