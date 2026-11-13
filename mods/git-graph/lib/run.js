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

/** Network steps, and archive (a big tree takes a while to write). */
const NETWORK = new Set(["push", "fetch", "pull", "archive"]);

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
 * Whether a guard's git result meets its expectation.
 * @param {{expect: "ok"|"empty"|{equals:string}}} guard
 * @param {{code:number, stdout?:string}} r
 */
export function guardPasses(guard, r) {
  if (r.code !== 0) return false;
  const out = String(r.stdout ?? "").trim();
  if (guard.expect === "ok") return true;
  if (guard.expect === "empty") return out === "";
  return typeof guard.expect === "object" && out === guard.expect.equals;
}

/**
 * A failed guard's message, "{out}" replaced by its output ("detached HEAD" when none).
 * @param {{message:string}} guard
 * @param {{stdout?:string}|null} r
 */
export function guardMessage(guard, r) {
  const out = String(r?.stdout ?? "").trim() || "detached HEAD";
  return guard.message.replaceAll("{out}", out);
}

/**
 * The toasts after a plan ran: a failure always shows its error (stderr tail); conflicts that
 * appeared during this run (none before it) add the conflict warning.
 * @param {string} label
 * @param {{failed: {code:number, stdout?:string, stderr?:string}|Error|null, conflicts: boolean, conflictsBefore?: boolean}} o
 * @returns {{title:string, body:string, level:"error"|"warning"}[]}
 */
export function outcome(label, { failed, conflicts, conflictsBefore = false }) {
  const out = [];
  if (failed) {
    const body = failed instanceof Error ? String(failed.message).slice(-400) : errorTail(failed);
    out.push({ title: `${label} failed`, body, level: "error" });
  }
  if (conflicts && !conflictsBefore) out.push({ title: "Conflicts", body: "Resolve in nvim or Changes", level: "warning" });
  return out;
}

/** A handed-off request older than this is ignored (never run late). */
export const REQUEST_TTL = 10000;

/**
 * Whether a `git-graph.request` should be acted on by a panel copy now.
 * @param {any} req
 * @param {string} owner this copy's uid
 * @param {string|null} seen the last request id this copy handled
 * @param {number} now ms
 * @returns {"run"|"skip"|"stale"}
 */
export function requestState(req, owner, seen, now) {
  if (!req || req.owner !== owner || req.id === seen) return "skip";
  if (!Number.isFinite(req.at) || now - req.at > REQUEST_TTL || req.at - now > REQUEST_TTL) return "stale";
  return "run";
}

/** "Cherry Pick…" → "Cherry Pick": a menu label as the busy / toast label. */
export const actionLabel = (menuLabel) => String(menuLabel).replace(/…$/, "").trim();
