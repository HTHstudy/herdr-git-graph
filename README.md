# herdr-git-graph

A Herdr mod that recreates the VS Code Git Graph view.

## Features (beyond the graph itself)

- **Copy Commit Message / Copy Stash Message to Clipboard** in the right-click menu: the
  full message (subject and body), read with `git log -1 --format=%B` when chosen.
- **Selectable commit details**: in an expanded commit, the message body and the
  Author / Committer / Date values can be drag-selected and copied with cmd-c. The full
  hash stays click-to-copy.
- **Diff in its own tab** (default): clicking a file opens the space's one **Diff** tab
  (opened on first use, reused after that). The diff header's **Open in: Tab | Pane**
  toggle switches to the old behavior, a diff pane split in beside the work; the choice is
  shared (`git-graph.diffWhere` = `tab` | `split`). Esc or ✕ closes the diff tab (or pane).
  While a diff tab or pane has the focus, the Graph keeps showing its repository.
- **Ref chips**: drawn in the monospace font so their widths are exact (names over 22
  columns end in "…"), each with an icon (branch; check for the checked-out branch; cloud
  for a remote branch; tag; commit for a detached HEAD). A local branch and its same-named
  remote branch on the same commit share one chip (`main | origin`); right-click or
  double-click acts on the part under the pointer. The checked-out branch's chip is filled
  with its lane color and comes first; HEAD's row has a faint tint of that color.
- **Double-click a branch label** to check it out (a remote branch opens the Checkout dialog).
- **Lane colors**: 12 colors from the theme's ansi palette, starting with blue.
- **Branches dropdown** floats over the graph instead of pushing it down.

## Install (development)

```sh
scripts/link.sh          # copies mods/* into ~/.config/herdr-app/mods
scripts/watch-copy.sh    # keep the copy in sync while editing (needs fswatch)
scripts/link.sh --link   # symlink instead (see below)
```

Herdr's hot reload does not pick up edits made through a symlinked mod
folder (verified: `herdr-app check` passes, but a live pane kept the old
render after editing). A copied folder reloads immediately, so copying is the
default. The script never overwrites an existing real folder it did not create.

Tests: `npm test`.

## Install into the right panel

Herdr's shipped layouts (`main`, `terminals`, `win98`) are Herdr's: they are
replaced on every start, and an edited one is set aside as `<name>-edited`.
So clone the layout, patch only the clone, and switch to it:

```sh
HA=/Applications/Herdr.app/Contents/MacOS/Herdr
scripts/link.sh
$HA do layout.clone '{"name":"main","as":"main-graph"}'   # also switches to it
node scripts/patch-layout.mjs ~/.config/herdr-app/layouts/main-graph.json
$HA do layout.switch '{"name":"main-graph"}'
```

The patch adds a `graph` block to the `panel-body` stack and swaps the `tabs`
bar for `git-graph-tabs` (a clone of `tabs` with a Graph button after Changes).
It is idempotent, refuses `main.json`, `terminals.json` and `win98.json`
(exit 1, nothing written), and writes `<layout>.json.bak` once: the clone as it
was before its first patch. The Graph button shows only on a layout whose
`panel-body` has a `graph` block, so `git-graph-tabs` is harmless elsewhere.

The repo's `mods/` folders are the source: edit there and re-run
`scripts/link.sh`, never the copies in `~/.config/herdr-app/mods`.

## Undo

Switch back to the shipped layout (`$HA do layout.switch '{"name":"main"}'`),
which was never edited. Optionally restore `<clone>.json.bak` over the clone (its
first-run state) or delete the clone. Then delete
`~/.config/herdr-app/mods/git-graph` and `~/.config/herdr-app/mods/git-graph-tabs`.

## Status

- ✅ verified: `npm test` (155 passing), including the layout patch on a copy of a real layout and real-git guard tests (stash index shift, moved branch tip, tag named like a branch).
- ✅ verified: `herdr-app check` passes for `git-graph` and `git-graph-tabs`.
- ✅ verified: patched `main-copy.json` (a clone) loads with no `*.error` files and empty `errors` in `herdr-app status`.
- ⏳ needs a manual check: switch to the patched clone and confirm the Files, Changes and Graph buttons (the welcome's `workspace.panels` lists only files and changes; the bar adds Graph when the layout has a `graph` block).
- ⏳ needs a manual check: the Graph button switches the panel like Changes does, and light/dark theme switching.
- ⏳ needs a manual check: the rest of the spec done-checklist walked in the live window, including a repo with 10k+ commits (not done, since driving the user's window was not allowed).
