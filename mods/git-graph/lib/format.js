// Pure display helpers for the Graph panel. Plain ES module (runs in Herdr and Node).

import { MAX_LANES } from "./lanes.js";

/** Pixels between lane centers, and the graph cell's horizontal padding (both sides together). */
export const LANE_WIDTH = 14;
export const GRAPH_PAD = 10;

/** Center x of a lane inside the graph cell. */
export const laneX = (lane) => GRAPH_PAD / 2 + lane * LANE_WIDTH + LANE_WIDTH / 2;

/**
 * Width of the graph cell: every row uses the same width so subjects line up.
 * @param {{lane:number, lines:{from:number, to:number}[]}[]} rows
 */
export function graphWidth(rows) {
  let lanes = 1;
  for (const r of rows) {
    lanes = Math.max(lanes, r.lane + 1);
    for (const l of r.lines) lanes = Math.max(lanes, l.from + 1, l.to + 1);
  }
  return Math.min(lanes, MAX_LANES) * LANE_WIDTH + GRAPH_PAD;
}

/**
 * Which optional columns fit at a panel width.
 * <420 graph+subject; >=420 +author; >=560 +date; >=680 +short hash.
 * @param {number} width
 */
export function visibleColumns(width) {
  const w = Number(width) || 0;
  return { author: w >= 420, date: w >= 560, hash: w >= 680 };
}

/**
 * Short relative age, e.g. `3h ago`.
 * @param {number} unix seconds
 * @param {number} now seconds
 */
export function relativeDate(unix, now) {
  if (!Number.isFinite(unix) || unix <= 0) return "";
  const s = Math.max(0, Math.floor(now - unix));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/**
 * @typedef {{label:string, kind:"head"|"remote"|"tag", bold:boolean, ref:object|null}} Chip
 */

const ORDER = { head: 0, remote: 1, tag: 2 };

/**
 * Ref chips grouped by the commit hash they draw on (tags already peeled by parseRefs).
 * The current branch comes first and is bold; when detached, a bold "HEAD" chip leads on headHash.
 * @param {{hash:string, kind:"head"|"remote"|"tag", short:string, current:boolean}[]} refs
 * @param {string|null} head current branch name, null when detached
 * @param {string|null} headHash
 * @returns {Map<string, Chip[]>}
 */
export function refChips(refs, head, headHash) {
  /** @type {Map<string, Chip[]>} */
  const out = new Map();
  const add = (hash, chip) => {
    if (!out.has(hash)) out.set(hash, []);
    out.get(hash).push(chip);
  };
  if (head === null && headHash) add(headHash, { label: "HEAD", kind: "head", bold: true, ref: null });
  const sorted = refs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(b.r.current) - Number(a.r.current) || ORDER[a.r.kind] - ORDER[b.r.kind] || a.i - b.i);
  for (const { r } of sorted) add(r.hash, { label: r.short, kind: r.kind, bold: Boolean(r.current && head !== null), ref: r });
  return out;
}
