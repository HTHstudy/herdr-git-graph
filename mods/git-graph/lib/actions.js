// Menus, dialogs and action plans (git argv) for every Git Graph action.
// Pure: no herdr / node imports. Plans are argv arrays WITHOUT the leading "git".
//
// Target = {kind:"commit",hash,parents,subject} | {kind:"branch",name,current}
//        | {kind:"remote",name,remote,branch} | {kind:"tag",name,annotated,hash}
//        | {kind:"stash",selector,hash} | {kind:"uncommitted"}
// Ctx    = {head: string|null, remotes: string[], filtered: string[], dropable?: boolean}
//          dropable: the right-clicked commit is reachable from HEAD with no merge commit
//          between it and HEAD (checked at right-click; see dropChecks). Drop needs it true.
// Plan   = {steps: string[][], guards?: Guard[]} | {copy} | {ui, arg?}
// Guard  = {argv: string[], expect: "ok"|"empty"|{equals: string}, message: string}: git argv
//          (no "git") run before any step; one that fails aborts the plan with `message`
//          ("{out}" in it is replaced by the guard's trimmed output).

import { READ } from "./git.js";

const M = (id, label) => ({ id, label });
const SEP = "sep";

const MERGE = M("merge", "Merge into current branch…");
const MERGE_BRANCH = M("mergeBranch", "Merge into current branch…");
const ARCHIVE = M("archive", "Create Archive");
const UNSELECT = M("unselect", "Unselect in Branches Dropdown");

/** Drop falsy entries, collapse repeated / leading / trailing separators. */
function tidy(items) {
  const out = [];
  for (const it of items) {
    if (!it) continue;
    if (it === SEP && (out.length === 0 || out[out.length - 1] === SEP)) continue;
    out.push(it);
  }
  if (out[out.length - 1] === SEP) out.pop();
  return out;
}

/** @returns {(MenuItem|"sep")[]} */
export function menuFor(target, ctx) {
  const hasRemotes = ctx.remotes.length > 0;
  const attachedHead = ctx.head !== null;
  switch (target.kind) {
    case "commit": {
      const attached = ctx.head !== null;
      const droppable = attached && target.parents.length === 1 && ctx.dropable === true;
      return tidy([
        M("addTag", "Add Tag…"), M("createBranch", "Create Branch…"), SEP,
        M("checkout", "Checkout…"), M("cherryPick", "Cherry Pick…"), M("revert", "Revert…"),
        droppable && M("drop", "Drop…"), SEP,
        attached && MERGE,
        attached && M("rebase", "Rebase current branch on this Commit…"),
        attached && M("reset", "Reset current branch to this Commit…"), SEP,
        M("copyHash", "Copy Commit Hash to Clipboard"),
        M("copySubject", "Copy Commit Subject to Clipboard"),
      ]);
    }
    case "branch": {
      const tail = [
        SEP, ARCHIVE, ctx.filtered.includes(target.name) && UNSELECT, SEP,
        M("copyName", "Copy Branch Name to Clipboard"),
      ];
      const push = hasRemotes && M("pushBranch", "Push Branch…");
      if (target.current) return tidy([M("renameBranch", "Rename Branch…"), push, ...tail]);
      return tidy([
        M("checkoutBranch", "Checkout Branch"), M("renameBranch", "Rename Branch…"),
        M("deleteBranch", "Delete Branch…"), attachedHead && MERGE_BRANCH,
        attachedHead && M("rebaseOnBranch", "Rebase current branch on Branch…"), push, ...tail,
      ]);
    }
    case "remote":
      return tidy([
        M("checkoutRemote", "Checkout Branch…"), M("deleteRemote", "Delete Remote Branch…"),
        M("fetchIntoLocal", "Fetch into local branch…"), attachedHead && MERGE_BRANCH,
        attachedHead && M("pullBranch", "Pull into current branch…"), SEP,
        ARCHIVE, ctx.filtered.includes(target.name) && UNSELECT, SEP,
        M("copyName", "Copy Branch Name to Clipboard"),
      ]);
    case "tag":
      return tidy([
        target.annotated && M("tagDetails", "View Details"),
        M("deleteTag", "Delete Tag…"), hasRemotes && M("pushTag", "Push Tag…"), SEP,
        ARCHIVE, SEP, M("copyTagName", "Copy Tag Name to Clipboard"),
      ]);
    case "uncommitted":
      return tidy([
        M("stashPush", "Stash uncommitted changes…"),
        M("resetUncommitted", "Reset uncommitted changes…"),
        M("clean", "Clean untracked files…"), SEP, M("openChanges", "Open Changes panel"),
      ]);
    case "stash":
      return tidy([
        M("stashApply", "Apply Stash…"), M("stashBranch", "Create Branch from Stash…"),
        M("stashPop", "Pop Stash…"), M("stashDrop", "Drop Stash…"), SEP,
        M("copyStashName", "Copy Stash Name to Clipboard"),
        M("copyStashHash", "Copy Stash Hash to Clipboard"),
      ]);
    default:
      return [];
  }
}

// ---- dialogs ---------------------------------------------------------------

const text = (key, label, value = "") => ({ key, label, type: "text", value });
const check = (key, label, value = false) => ({ key, label, type: "checkbox", value });
const radio = (key, label, options, value) => ({ key, label, type: "radio", options, value });
const select = (key, label, options, value) => ({ key, label, type: "select", options, value });
const opts = (list) => list.map((v) => ({ value: v, label: v }));
const dlg = (title, detail, confirm, fields = [], danger = false) => ({ title, detail, danger, confirm, fields });

const short = (h) => String(h).slice(0, 7);
const remoteName = (v, ctx) => v.remote ?? ctx.remotes[0];
const afterSlash = (n) => n.slice(n.indexOf("/") + 1);
const modeRadio = (extra) => radio("mode", "Mode", [
  ...(extra ? [{ value: "soft", label: "Soft - keep changes staged" }] : []),
  { value: "mixed", label: "Mixed - keep changes unstaged" },
  { value: "hard", label: "Hard - discard all changes" },
], "mixed");

/** Radio of a merge commit's parents (numbered from 1); [] for non-merge commits. */
function parentField(t) {
  if (t.parents.length < 2) return [];
  return [radio("parent", "Parent number", t.parents.map((p, i) => ({ value: i + 1, label: `${i + 1}: ${short(p)}` })), 1)];
}

const refName = (t) => (t.kind === "commit" ? short(t.hash) : t.name);
const mergeFields = [check("noFF", "Create a new commit even if fast-forward is possible", true),
  check("squash", "Squash commits"), check("noCommit", "No commit")];
const remoteSelect = (label, ctx) => select("remote", label, opts(ctx.remotes), ctx.remotes[0]);

/**
 * Dialog `values` keys are the Field keys listed per id below.
 * @returns {Dialog|null}
 */
export function dialogFor(id, t, ctx) {
  switch (id) {
    // addTag: name, annotated, message, push, remote
    case "addTag":
      return dlg("Add Tag", `Commit ${short(t.hash)}`, "Add Tag", [
        text("name", "Name"), check("annotated", "Annotated tag", true), text("message", "Message"),
        ...(ctx.remotes.length ? [check("push", "Push to remote"), remoteSelect("Remote", ctx)] : []),
      ]);
    // createBranch: name, checkout
    case "createBranch":
      return dlg("Create Branch", `At commit ${short(t.hash)}`, "Create Branch",
        [text("name", "Name"), check("checkout", "Check out")]);
    case "checkout":
      return dlg("Checkout Commit", `Detach HEAD at ${short(t.hash)}`, "Checkout");
    // cherryPick: parent (merge commits only), noCommit
    case "cherryPick":
      return dlg("Cherry Pick", `Cherry pick ${short(t.hash)}: ${t.subject}`, "Cherry Pick",
        [...parentField(t), check("noCommit", "No commit")]);
    // revert: parent (merge commits only)
    case "revert":
      return dlg("Revert", `Revert ${short(t.hash)}: ${t.subject}`, "Revert", parentField(t));
    case "drop":
      return dlg("Drop Commit", `Remove ${short(t.hash)}: ${t.subject} from history`, "Drop", [], true);
    // merge / mergeBranch: noFF, squash, noCommit
    case "merge":
    case "mergeBranch":
      return dlg("Merge", `Merge ${refName(t)} into ${ctx.head}`, "Merge", mergeFields);
    case "rebase":
    case "rebaseOnBranch":
      return dlg("Rebase", `Rebase ${ctx.head} on ${refName(t)}`, "Rebase");
    // reset: mode (soft|mixed|hard)
    case "reset":
      return dlg("Reset", `Reset ${ctx.head} to ${short(t.hash)}`, "Reset", [modeRadio(true)], true);
    // renameBranch: name
    case "renameBranch":
      return dlg("Rename Branch", `Rename ${t.name}`, "Rename", [text("name", "New name", t.name)]);
    // deleteBranch: force
    case "deleteBranch":
      return dlg("Delete Branch", `Delete branch ${t.name}`, "Delete", [check("force", "Force delete")], true);
    // pushBranch: remote, setUpstream, force
    case "pushBranch":
      return dlg("Push Branch", `Push ${t.name}`, "Push", [
        remoteSelect("Remote", ctx), check("setUpstream", "Set upstream", true),
        check("force", "Force push (with lease)"),
      ]);
    // archive: format (zip|tar), name, folder (filled by the UI via pickFolder)
    case "archive":
      return dlg("Create Archive", `Archive ${t.name}`, "Create", [
        radio("format", "Format", [{ value: "zip", label: "zip" }, { value: "tar", label: "tar" }], "zip"),
        text("name", "File name", ""), text("folder", "Folder", ""),
      ]);
    // checkoutRemote: local
    case "checkoutRemote":
      return dlg("Checkout Remote Branch", `Create a local branch tracking ${t.name}`, "Checkout",
        [text("local", "Local branch name", afterSlash(t.name))]);
    case "deleteRemote":
      return dlg("Delete Remote Branch", `Delete ${t.branch} from ${t.remote}`, "Delete", [], true);
    // fetchIntoLocal: local, force
    case "fetchIntoLocal":
      return dlg("Fetch into Local Branch", `Fetch ${t.name} into a local branch`, "Fetch",
        [text("local", "Local branch", t.branch), check("force", "Force")]);
    // pullBranch: noFF, squash
    case "pullBranch":
      return dlg("Pull", `Pull ${t.name} into ${ctx.head}`, "Pull",
        [check("noFF", "Create a new commit even if fast-forward is possible"), check("squash", "Squash commits")]);
    // deleteTag: remote (checkbox), remoteName
    case "deleteTag":
      return dlg("Delete Tag", `Delete tag ${t.name}`, "Delete", [
        check("remote", "Also delete on remote"),
        ...(ctx.remotes.length ? [select("remoteName", "Remote", opts(ctx.remotes), ctx.remotes[0])] : []),
      ], true);
    // pushTag: remote
    case "pushTag":
      return dlg("Push Tag", `Push tag ${t.name}`, "Push", [remoteSelect("Remote", ctx)]);
    // stashPush: includeUntracked, message
    case "stashPush":
      return dlg("Stash", "Stash uncommitted changes", "Stash",
        [check("includeUntracked", "Include untracked files", true), text("message", "Message")]);
    // resetUncommitted: mode (mixed|hard)
    case "resetUncommitted":
      return dlg("Reset Uncommitted Changes", "Reset to HEAD", "Reset", [modeRadio(false)], true);
    // clean: dirs
    case "clean":
      return dlg("Clean Untracked Files", "Delete untracked files", "Clean", [check("dirs", "Also directories")], true);
    // stashApply / stashPop: index
    case "stashApply":
    case "stashPop":
      return dlg(id === "stashPop" ? "Pop Stash" : "Apply Stash", t.selector,
        id === "stashPop" ? "Pop" : "Apply", [check("index", "Restore index")]);
    // stashBranch: name
    case "stashBranch":
      return dlg("Create Branch from Stash", t.selector, "Create Branch", [text("name", "Branch name")]);
    case "stashDrop":
      return dlg("Drop Stash", `Drop ${t.selector}`, "Drop", [], true);
    default:
      return null;
  }
}

// ---- plans -----------------------------------------------------------------

/**
 * Checks that make Drop safe: the commit is on the current branch, and no merge lies between
 * it and HEAD (a plain rebase would flatten it). Run at right-click (Ctx.dropable) and again
 * as guards right before the rebase.
 * @param {string} hash
 * @returns {Guard[]}
 */
export function dropChecks(hash) {
  return [
    { argv: [...READ, "merge-base", "--is-ancestor", hash, "HEAD"], expect: "ok",
      message: `Commit ${short(hash)} is not on the current branch: nothing was dropped.` },
    { argv: [...READ, "rev-list", "--merges", `${hash}..HEAD`], expect: "empty",
      message: `A merge commit follows ${short(hash)} on the current branch: dropping it would flatten the merge. Nothing was dropped.` },
  ];
}

/**
 * The branch the dialog named is still checked out.
 * @param {string|null} head
 * @returns {Guard}
 */
export function headGuard(head) {
  return { argv: [...READ, "symbolic-ref", "--short", "-q", "HEAD"], expect: { equals: String(head ?? "") },
    message: "Current branch changed to {out} — reopen the menu." };
}

const flags = (pairs) => pairs.filter(([on]) => on).map(([, f]) => f);
const steps = (...s) => ({ steps: s });
/** Steps that act on the current branch: guarded so they still act on the branch shown. */
const onHead = (ctx, plan, extra = []) => ({ ...plan, guards: [...extra, headGuard(ctx.head)] });

/** @returns {Plan} */
export function planFor(id, t, v, ctx) {
  v = v ?? {};
  const parent = t.kind === "commit" && t.parents.length > 1 ? ["-m", String(v.parent ?? 1)] : [];
  switch (id) {
    case "addTag": {
      const tag = v.annotated ? ["tag", "-a", v.name, "-m", v.message ?? "", t.hash] : ["tag", v.name, t.hash];
      const rem = remoteName(v, ctx);
      return v.push && rem ? steps(tag, ["push", rem, `refs/tags/${v.name}`]) : steps(tag);
    }
    case "createBranch":
      return steps(v.checkout ? ["checkout", "-b", v.name, t.hash] : ["branch", v.name, t.hash]);
    case "checkout": return steps(["checkout", t.hash]);
    case "cherryPick":
      return steps(["cherry-pick", ...parent, ...flags([[v.noCommit, "--no-commit"]]), t.hash]);
    case "revert": return steps(["revert", "--no-edit", ...parent, t.hash]);
    case "drop": return onHead(ctx, steps(["rebase", "--onto", `${t.hash}^`, t.hash]), dropChecks(t.hash));
    case "merge":
    case "mergeBranch":
      return onHead(ctx, steps(["merge", ...flags([[v.noFF, "--no-ff"], [v.squash, "--squash"], [v.noCommit, "--no-commit"]]),
        t.kind === "commit" ? t.hash : t.name]));
    case "rebase": return onHead(ctx, steps(["rebase", t.hash]));
    case "rebaseOnBranch": return onHead(ctx, steps(["rebase", t.name]));
    case "reset": return onHead(ctx, steps(["reset", `--${v.mode ?? "mixed"}`, t.hash]));
    case "checkoutBranch": return steps(["checkout", t.name]);
    case "renameBranch": return steps(["branch", "-m", t.name, v.name]);
    case "deleteBranch": return steps(["branch", v.force ? "-D" : "-d", t.name]);
    case "pushBranch":
      return steps(["push", ...flags([[v.setUpstream, "--set-upstream"], [v.force, "--force-with-lease"]]),
        remoteName(v, ctx), t.name]);
    case "archive": {
      const format = v.format ?? "zip";
      const name = v.name || `${t.name.replaceAll("/", "-")}.${format}`;
      return steps(["archive", `--format=${format}`, "-o", `${v.folder}/${name}`, t.name]);
    }
    case "checkoutRemote":
      return steps(["checkout", "-b", v.local ?? afterSlash(t.name), "--track", t.name]);
    case "deleteRemote": return steps(["push", t.remote, "--delete", t.branch]);
    case "fetchIntoLocal":
      return steps(["fetch", t.remote, `${v.force ? "+" : ""}${t.branch}:${v.local ?? t.branch}`]);
    case "pullBranch":
      return onHead(ctx, steps(["pull", ...flags([[v.noFF, "--no-ff"], [v.squash, "--squash"]]), t.remote, t.branch]));
    case "deleteTag": {
      const s = [["tag", "-d", t.name]];
      if (v.remote) s.push(["push", v.remoteName ?? ctx.remotes[0], "--delete", `refs/tags/${t.name}`]);
      return { steps: s };
    }
    case "pushTag": return steps(["push", remoteName(v, ctx), `refs/tags/${t.name}`]);
    case "stashPush":
      return steps(["stash", "push", ...flags([[v.includeUntracked, "--include-untracked"]]),
        ...(v.message ? ["-m", v.message] : [])]);
    case "resetUncommitted": return steps(["reset", `--${v.mode ?? "mixed"}`, "HEAD"]);
    case "clean": return steps(["clean", "-f", ...flags([[v.dirs, "-d"]])]);
    case "stashApply":
    case "stashPop":
      return steps(["stash", id === "stashPop" ? "pop" : "apply", ...flags([[v.index, "--index"]]), t.selector]);
    case "stashBranch": return steps(["stash", "branch", v.name, t.selector]);
    case "stashDrop": return steps(["stash", "drop", t.selector]);
    case "copyHash": return { copy: t.hash };
    case "copySubject": return { copy: t.subject };
    case "copyName":
    case "copyTagName":
    case "copyStashName": return { copy: id === "copyStashName" ? t.selector : t.name };
    case "copyStashHash": return { copy: t.hash };
    case "unselect": return { ui: "unselect", arg: t.name };
    case "openChanges": return { ui: "openChanges" };
    case "tagDetails": return { ui: "tagDetails", arg: t.name };
    default: throw new Error(`unknown action: ${id}`);
  }
}
