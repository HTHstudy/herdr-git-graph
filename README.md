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

```sh
scripts/link.sh
node scripts/patch-layout.mjs ~/.config/herdr-app/layouts/<layout>.json
```

The patch adds a `graph` block to the `panel-body` stack and swaps the `tabs`
bar for `git-graph-tabs` (a clone of `tabs` with a Graph button after Changes).
It is idempotent and writes `<layout>.json.bak` once. Switch to the patched
layout (`layout.switch`) to see Files, Changes and Graph.

## Undo

Restore `<layout>.json.bak` over the layout, then delete
`~/.config/herdr-app/mods/git-graph` and `~/.config/herdr-app/mods/git-graph-tabs`.

## Status

- ✅ verified: `npm test` (118 passing), including the layout patch on a copy of a real layout.
- ✅ verified: `herdr-app check` passes for `git-graph` and `git-graph-tabs`.
- ✅ verified: patched `main-copy.json` loads with no `*.error` files and empty `errors` in `herdr-app status`.
- ⏳ needs a manual check: the live layout is `main`, not `main-copy`, so the Graph button is not visible yet (a window shot shows Files and Changes only). Switch layouts or patch `main.json`, then confirm the three buttons.
- ⏳ needs a manual check: the Graph button switches the panel like Changes does, and light/dark theme switching.
- ⏳ needs a manual check: the rest of the spec done-checklist walked in the live window, including a repo with 10k+ commits (not done, since driving the user's window was not allowed).

