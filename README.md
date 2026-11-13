# herdr-git-graph

A Herdr mod that recreates the VS Code Git Graph view.

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

- ✅ verified: `npm test` (127 passing), including the layout patch on a copy of a real layout and real-git guard tests (stash index shift, moved branch tip, tag named like a branch).
- ✅ verified: `herdr-app check` passes for `git-graph` and `git-graph-tabs`.
- ✅ verified: patched `main-copy.json` (a clone) loads with no `*.error` files and empty `errors` in `herdr-app status`.
- ⏳ needs a manual check: switch to the patched clone and confirm the Files, Changes and Graph buttons (the welcome's `workspace.panels` lists only files and changes; the bar adds Graph when the layout has a `graph` block).
- ⏳ needs a manual check: the Graph button switches the panel like Changes does, and light/dark theme switching.
- ⏳ needs a manual check: the rest of the spec done-checklist walked in the live window, including a repo with 10k+ commits (not done, since driving the user's window was not allowed).
