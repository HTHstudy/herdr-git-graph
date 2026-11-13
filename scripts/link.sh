#!/bin/sh
# Copy (or with --link, symlink) each mods/* folder into ~/.config/herdr-app/mods.
# Never overwrites an existing real folder.
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
dest="$HOME/.config/herdr-app/mods"
# Default is copy: Herdr hot reload does not follow symlinked mod folders (see README).
copy=1; [ "${1:-}" = "--link" ] && copy=0
mkdir -p "$dest"
status=0
for src in "$root"/mods/*/; do
  src=${src%/}; name=$(basename "$src"); target="$dest/$name"
  if [ $copy -eq 1 ]; then
    if [ -L "$target" ]; then rm "$target"; fi
    if [ -e "$target" ] && [ ! -f "$target/.git-graph-copy" ]; then
      echo "refusing to overwrite existing folder: $target" >&2; status=1; continue
    fi
    mkdir -p "$target" && cp -R "$src"/. "$target"/ && touch "$target/.git-graph-copy"
    echo "copied $name"
  else
    if [ -L "$target" ]; then rm "$target"
    elif [ -e "$target" ]; then
      echo "refusing to overwrite existing folder: $target" >&2; status=1; continue
    fi
    ln -s "$src" "$target" && echo "linked $name -> $src"
  fi
done
exit $status
