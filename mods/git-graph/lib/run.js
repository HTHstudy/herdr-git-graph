// Pure parts of running an action plan: the busy lock's value, argv/timeout per step, and what
// to tell the person afterwards. Plain ES module (runs in Herdr and Node).

/** A busy value older than this is left over (e.g. a quit mid-action) and ignored. */
export const BUSY_STALE = 10 * 60 * 1000;
/** Per-step timeouts: network steps get longer. */
export const NETWORK_TIMEOUT = 120000;
export const LOCAL_TIMEOUT = 30000;

/**
 * The value stored in `git-graph.busy.<root>` while an action runs.
 * @param {string} label
 * @param {number} now ms
 */
export const busyValue = (label, now) => ({ label, since: now });

/**
 * The running action's label, or null when the value is empty, malformed or stale.
 * @param {unknown} value
 * @param {number} now ms
 * @returns {string|null}
 */
export function busyLabel(value, now) {
  if (!value || typeof value !== "object") return null;
  const { label, since } = /** @type {any} */ (value);
  if (typeof label !== "string" || !Number.isFinite(since)) return null;
  if (now - since > BUSY_STALE || since - now > BUSY_STALE) return null;
  return label;
}

const NETWORK = new Set(["push", "fetch", "pull"]);

/** @param {string[]} step git argv without "git" */
export const stepTimeout = (step) => (NETWORK.has(step[0]) ? NETWORK_TIMEOUT : LOCAL_TIMEOUT);

/**
 * `env` argv that runs git with no credential prompt and no editor, so nothing can hang.
 * (Unix only: on Windows there is no `env`; not handled in this version.)
 * @param {string[]} step
 */
export const envArgv = (step) => ["GIT_TERMINAL_PROMPT=0", "GIT_EDITOR=true", "GIT_MERGE_AUTOEDIT=no", "git", ...step];

/**
 * The end of a failed step's output, for a toast.
 * @param {{code:number, stdout?:string, stderr?:string}} r
 */
export function errorTail(r) {
  const s = String(r.stderr || r.stdout || "").trim();
  return s ? s.slice(-400) : `git exited ${r.code}`;
}

/** @param {{conflict:boolean}[]} entries parsed status */
export const hasConflicts = (entries) => entries.some((e) => e.conflict);

/**
 * The toasts after a plan ran. A failure that left conflicts (cherry-pick, merge, rebase,
 * revert, stash pop all exit non-zero then) is reported as the conflict, not as an error.
 * @param {string} label
 * @param {{failed: {code:number, stdout?:string, stderr?:string}|Error|null, conflicts: boolean}} o
 * @returns {{title:string, body:string, level:"error"|"warning"}[]}
 */
export function outcome(label, { failed, conflicts }) {
  if (conflicts && failed) return [{ title: "Conflicts", body: "Resolve in nvim or Changes", level: "warning" }];
  if (!failed) return [];
  const body = failed instanceof Error ? String(failed.message).slice(-400) : errorTail(failed);
  return [{ title: `${label} failed`, body, level: "error" }];
}

/** "Cherry Pick…" → "Cherry Pick": a menu label as the busy / toast label. */
export const actionLabel = (menuLabel) => String(menuLabel).replace(/…$/, "").trim();
