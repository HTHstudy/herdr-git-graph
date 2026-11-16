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

/**
 * Chip geometry: rows draw each chip at exactly this width so a right-click can tell which was
 * hit. Labels are drawn in the monospace font at 11px, where every glyph advances 0.6em (6.6px;
 * bold the same), so the width is exact rather than estimated. A wide (CJK, emoji) character
 * takes two columns.
 */
export const CHIP_GAP = 4;
export const CHIP_FONT = 11;
const CHIP_CHAR = 6.6; // 0.6em at 11px
const CHIP_PAD = 5; // each side
const CHIP_BORDER = 1; // each side
/** Longer labels are cut to this many columns, the last one "…". */
export const CHIP_COLS = 22;

const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;

/** Monospace columns of one character (a code point). */
const cols = (ch) => (WIDE.test(ch) ? 2 : 1);

/** Monospace columns of a text. */
export function textColumns(text) {
  let n = 0;
  for (const ch of String(text)) n += cols(ch);
  return n;
}

/** The text a chip shows: the label, or its first columns and "…" when wider than CHIP_COLS. */
export function chipText(label) {
  const s = String(label);
  if (textColumns(s) <= CHIP_COLS) return s;
  let out = "", n = 0;
  for (const ch of s) {
    if (n + cols(ch) > CHIP_COLS - 1) break;
    out += ch; n += cols(ch);
  }
  return out + "…";
}

/**
 * Width of a ref chip (border box) for its shown text. Bold has the same advance in a
 * monospace font, so it doesn't change the width.
 * @param {string} label
 * @param {boolean} [_bold]
 */
export function chipWidth(label, _bold = false) {
  return Math.ceil(CHIP_PAD * 2 + textColumns(chipText(label)) * CHIP_CHAR) + CHIP_BORDER * 2;
}

/**
 * How many logical px the pointer's local positions use per layout px (Herdr's zoom).
 * From the pressed item's reported height over its layout height when known, else `zoom`.
 * @param {{height?: number, size?: {height?: number}}|null|undefined} bounds
 * @param {number} layoutHeight
 * @param {unknown} zoom settings().zoom
 */
export function pointerScale(bounds, layoutHeight, zoom) {
  const h = bounds?.size?.height ?? bounds?.height;
  if (Number.isFinite(h) && h > 0 && layoutHeight > 0) {
    const s = h / layoutHeight;
    if (s >= 0.25 && s <= 4) return s;
  }
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * The chip under x (row-local px), or null. Chips start at `start` and sit CHIP_GAP apart.
 * @template {{label:string, bold?:boolean}} C
 * @param {C[]} chips
 * @param {number} x
 * @param {number} start
 * @returns {C|null}
 */
export function chipAt(chips, x, start) {
  let left = start;
  for (const c of chips) {
    const right = left + chipWidth(c.label, c.bold);
    if (x >= left && x < right) return c;
    left = right + CHIP_GAP;
  }
  return null;
}
