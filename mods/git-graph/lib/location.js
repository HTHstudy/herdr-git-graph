// Which folder the graph follows (pure). Like the shipped `changes` mod, but a focused
// pane without a folder (a mod pane, e.g. this mod's own diff pane) falls back to a
// terminal in the same tab before the space folder, which can be stale or deleted.
// With `keep` (the panel already shows a repo), a focused git-graph pane (a diff tab or
// pane, which has no terminal) keeps what the panel shows: null means "no change".

/**
 * @param {{space?: {folder?: string}|null, focused?: {pane?: string|null, tab?: string|null, cwd?: string|null}|null,
 *          panes: {pane: string, tab: string, cwd: string|null, mod?: string}[], keep?: boolean}} s
 * @returns {string|undefined|null} null: keep the current location
 */
export function pickCwd({ space, focused, panes, keep = false }) {
  const pane = focused?.pane ? panes.find((p) => p.pane === focused.pane) : null;
  if (keep && pane?.mod === "git-graph") return null;
  const sameTab = focused?.tab ? panes.find((p) => p.tab === focused.tab && p.cwd) : null;
  return pane?.cwd || focused?.cwd || sameTab?.cwd || space?.folder;
}
