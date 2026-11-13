// What a right-click names (a Target for lib/actions.js), the menu Ctx, menu/dialog sizes and
// dialog form helpers, and the tag details load. Plain ES module (runs in Herdr and Node).

import { READ } from "./git.js";
import { shortRef } from "./filter.js";

/**
 * Target for a graph row: commit, stash or the uncommitted row.
 * @param {{kind:string, hash:string, commit?:any, stash?:any}} row
 */
export function rowTarget(row) {
  if (row.kind === "uncommitted") return { kind: "uncommitted" };
  if (row.kind === "stash") return { kind: "stash", selector: row.stash.selector, hash: row.hash };
  const c = row.commit;
  return { kind: "commit", hash: c.hash, parents: [...c.parents], subject: c.subject };
}

/**
 * Split "origin/x" into remote and branch: the longest known remote that prefixes it, else the
 * part before the first "/".
 * @param {string} short
 * @param {string[]} remotes
 */
export function splitRemote(short, remotes) {
  const known = remotes.filter((r) => short.startsWith(r + "/")).sort((a, b) => b.length - a.length)[0];
  const remote = known ?? short.slice(0, Math.max(0, short.indexOf("/")));
  return { remote, branch: short.slice(remote.length + 1) };
}

/**
 * Target for a ref chip.
 * @param {{kind:"head"|"remote"|"tag", short:string, current:boolean, annotated:boolean, hash:string}} ref
 * @param {string[]} remotes
 */
export function refTarget(ref, remotes) {
  if (ref.kind === "head") return { kind: "branch", name: ref.short, current: Boolean(ref.current) };
  if (ref.kind === "tag") return { kind: "tag", name: ref.short, annotated: Boolean(ref.annotated), hash: ref.hash };
  return { kind: "remote", name: ref.short, ...splitRemote(ref.short, remotes) };
}

/**
 * The menu Ctx: `filtered` holds short names ("topic", "origin/x") as lib/actions.js compares
 * them against Target names; the panel's filter keeps full ref names.
 * @param {{head:string|null, remotes:string[]}} data
 * @param {string[]|null} filter
 */
export function menuCtx(data, filter) {
  return { head: data.head ?? null, remotes: [...data.remotes], filtered: (filter ?? []).map(shortRef) };
}

/** Pixel height of a menu popup (rows 31, separators 9, padding 5 each side, title 26). */
export function menuHeight(items, title = false) {
  let h = 10 + (title ? 26 : 0);
  for (const it of items) h += it === "sep" ? 9 : 31;
  return h;
}

/**
 * The menu's title line naming what was right-clicked.
 * @param {any} t Target
 */
export function targetTitle(t) {
  switch (t?.kind) {
    case "commit": return `commit ${t.hash.slice(0, 7)} · ${t.subject}`;
    case "branch": return `branch ${t.name}`;
    case "remote": return `remote ${t.name}`;
    case "tag": return `tag ${t.name}`;
    case "stash": return t.selector;
    case "uncommitted": return "Uncommitted changes";
    default: return "";
  }
}

/** Text fields that may stay empty (everything else typed is required). */
const OPTIONAL = new Set(["addTag:message", "stashPush:message", "archive:name"]);

/**
 * Field keys whose (trimmed) text is still empty but needed.
 * @param {string} id action id
 * @param {{fields: {key:string, type:string}[]}} dialog
 * @param {Record<string, unknown>} values
 */
export function missingFields(id, dialog, values) {
  return dialog.fields
    .filter((f) => f.type === "text" && !OPTIONAL.has(`${id}:${f.key}`) && !String(values[f.key] ?? "").trim())
    .map((f) => f.key);
}

/**
 * Values to hand planFor: text trimmed (a message keeps its inner text, minus outer blanks).
 * @param {{fields: {key:string, type:string}[]}} dialog
 * @param {Record<string, unknown>} values
 */
export function cleanValues(dialog, values) {
  const out = { ...values };
  for (const f of dialog.fields) if (f.type === "text") out[f.key] = String(values[f.key] ?? "").trim();
  return out;
}

/** Initial values from the dialog's fields. */
export function initialValues(dialog) {
  return Object.fromEntries(dialog.fields.map((f) => [f.key, f.value]));
}

/**
 * Height of a dialog overlay for its fields (title, detail, fields, buttons).
 * @param {{fields: {type:string, options?:unknown[]}[]}} dialog
 * @param {number} [extra] more pixels (e.g. an error line)
 */
export function dialogHeight(dialog, extra = 0) {
  let h = 36 + 26 + 30 + 52; // padding, title, detail, buttons
  for (const f of dialog.fields) {
    if (f.type === "text") h += 58;
    else if (f.type === "checkbox") h += 28;
    else if (f.type === "radio") h += 24 + 26 * (f.options?.length ?? 0);
    else h += 56; // select: label + a row of choices
  }
  return h + extra;
}

/**
 * git argv for an annotated tag's tagger, date and message.
 * @param {string} name tag short name
 */
export function tagDetailsArgs(name) {
  return [...READ, "for-each-ref",
    "--format=%(refname)%1f%(taggername)%1f%(taggeremail)%1f%(taggerdate:unix)%1f%(objectname)%1f%(*objectname)%1f%(contents)%1e",
    `refs/tags/${name}`];
}

/**
 * @param {string} stdout of tagDetailsArgs
 * @param {string} name
 * @returns {{tagger:string, email:string, date:number, hash:string, commit:string, message:string}|null}
 */
export function parseTagDetails(stdout, name) {
  for (const rec of String(stdout ?? "").split("\x1e")) {
    const r = rec.replace(/^\n/, "");
    if (!r) continue;
    const [ref, tagger, email, date, obj, peeled, ...msg] = r.split("\x1f");
    if (ref !== `refs/tags/${name}`) continue;
    return {
      tagger, email: email.replace(/^<|>$/g, ""), date: Number(date) || 0,
      hash: obj, commit: peeled || obj, message: msg.join("\x1f").replace(/\s+$/, ""),
    };
  }
  return null;
}
