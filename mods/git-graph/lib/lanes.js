// Lane layout for the commit graph. Pure: no host imports.

/** @typedef {{hash:string, parents:string[], author:string, email:string, date:string, subject:string}} Commit */
/** @typedef {{hash:string, base:string, selector:string, date:string, subject:string}} Stash */
/**
 * `top` draws from row top at lane `from` to row middle at lane `to`;
 * `bottom` from middle at `from` to row bottom at `to`.
 * @typedef {{from:number, to:number, color:number, half:"top"|"bottom"}} Line
 */
/**
 * @typedef {{kind:"commit"|"stash"|"uncommitted", hash:string, lane:number, color:number,
 *   lines:Line[], commit?:Commit, stash?:Stash}} Row
 */

/** Lanes >= MAX_LANES are drawn at lane MAX_LANES - 1. */
export const MAX_LANES = 12;
/**
 * Lane colors, by color index: theme keys, starting with blue (lane 0, usually main) and
 * cycling through 12. Everything that colors by lane maps through this.
 */
export const LANE_PALETTE = ["ansi4", "ansi2", "ansi5", "ansi3", "ansi6", "ansi1", "ansi12", "ansi10", "ansi13", "ansi11", "ansi14", "ansi9"];
const COLORS = LANE_PALETTE.length;

/** The theme key of a lane color index. */
export function laneColorKey(color) {
  const n = LANE_PALETTE.length;
  return LANE_PALETTE[((Number(color) % n) + n) % n] ?? LANE_PALETTE[0];
}

const cap = (n) => Math.min(n, MAX_LANES - 1);

/**
 * @param {Commit[]} commits
 * @param {Stash[]} stashes
 * @param {string|null} headHash
 * @param {boolean} uncommitted
 * @returns {Row[]}
 */
export function layoutGraph(commits, stashes, headHash, uncommitted) {
  /** @type {{hash:string, kind:Row["kind"], parents:string[], commit?:Commit, stash?:Stash}[]} */
  const nodes = [];
  if (uncommitted) nodes.push({ hash: "*", kind: "uncommitted", parents: headHash ? [headHash] : [] });
  const loaded = new Set(commits.map((x) => x.hash));
  const byBase = new Map();
  for (const s of stashes) {
    if (!loaded.has(s.base)) continue; // would dangle
    if (!byBase.has(s.base)) byBase.set(s.base, []);
    byBase.get(s.base).push(s);
  }
  for (const cm of commits) {
    for (const s of byBase.get(cm.hash) ?? []) nodes.push({ hash: s.hash, kind: "stash", parents: [s.base], stash: s });
    nodes.push({ hash: cm.hash, kind: "commit", parents: cm.parents, commit: cm });
  }

  /** @type {({hash:string, color:number}|null)[]} */
  const lanes = [];
  const firstFree = () => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };
  /** @type {Row[]} */
  const rows = [];

  for (const node of nodes) {
    /** @type {Line[]} */
    const lines = [];
    const line = (half, from, to, color) => lines.push({ half, from: cap(from), to: cap(to), color });

    // A stash is a separate line off its base: if no lane expects the base yet, reserve the
    // base's lane first so the stash never hands its own lane to the base.
    let reserved = -1;
    if (node.kind === "stash" && !lanes.some((l) => l && l.hash === node.parents[0])) {
      reserved = firstFree();
      lanes[reserved] = { hash: node.parents[0], color: reserved % COLORS };
    }

    let lane = lanes.findIndex((l) => l && l.hash === node.hash);
    const existing = lane !== -1;
    if (!existing) lane = firstFree();
    const color = existing ? lanes[lane].color : lane % COLORS;

    // top half: every active lane arrives; lanes holding this hash converge on `lane`
    lanes.forEach((l, i) => {
      if (!l || i === reserved) return;
      if (l.hash === node.hash) line("top", i, lane, l.color);
      else line("top", i, i, l.color);
    });
    // free lanes holding this hash (the row's own lane is reassigned below)
    lanes.forEach((l, i) => {
      if (l && l.hash === node.hash) lanes[i] = null;
    });

    // bottom half: pass-through for lanes not involved with this node
    lanes.forEach((l, i) => {
      if (l && i !== reserved) line("bottom", i, i, l.color);
    });

    node.parents.forEach((p, idx) => {
      const other = lanes.findIndex((l, i) => l && l.hash === p && i !== lane);
      if (other !== -1 && (idx > 0 || other < lane)) {
        line("bottom", lane, other, color); // merges into an existing lane: source color
      } else if (idx === 0) {
        lanes[lane] = { hash: p, color };
        line("bottom", lane, lane, color);
      } else {
        const k = lane === lanes.length || lanes[lane] === null ? firstFreeExcluding(lane) : firstFree();
        lanes[k] = { hash: p, color: k % COLORS };
        line("bottom", lane, k, k % COLORS);
      }
    });

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    /** @type {Row} */
    const row = { kind: node.kind, hash: node.hash, lane: cap(lane), color, lines };
    if (node.commit) row.commit = node.commit;
    if (node.stash) row.stash = node.stash;
    rows.push(row);
  }
  return rows;

  // first free slot other than `skip` (the row's own lane, which may be momentarily empty)
  function firstFreeExcluding(skip) {
    let i = 0;
    while (i === skip || (i < lanes.length && lanes[i] !== null)) i++;
    return i;
  }
}
